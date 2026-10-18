
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

async function main() {
  const databaseUrl = process.env.PROD_DATABASE_URL;
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!databaseUrl || !email || !password) {
    throw new Error(
      'PROD_DATABASE_URL, SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required'
    );
  }

  // Use the explicitly supplied production URL, not local DATABASE_URL.
  process.env.DATABASE_URL = databaseUrl;

  const prisma = new PrismaClient();

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const admin = await prisma.adminUser.upsert({
      where: { email },
      create: {
        email,
        name: 'Platform Owner',
        passwordHash,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      },
      update: {
        passwordHash,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        failedAttempts: 0,
        lockedUntil: null,
      },
      select: {
        email: true,
        role: true,
        status: true,
      },
    });

    console.log('Super Admin account is ready:', admin);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Admin setup failed:', error.message);
  process.exitCode = 1;
});
