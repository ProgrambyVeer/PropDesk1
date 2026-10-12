export type BangaloreLocality = { id: string; area: string; city: string; pincode: string };

const AREAS: [string, string][] = [
  ['Banashankari', '560050'], ['Basavanagudi', '560004'], ['Bellandur', '560103'], ['Benson Town', '560046'],
  ['BTM Layout', '560076'], ['CV Raman Nagar', '560093'], ['Devanahalli', '562110'], ['Domlur', '560071'],
  ['Electronic City', '560100'], ['Frazer Town', '560005'], ['Hebbal', '560024'], ['Hennur', '560043'],
  ['Hoodi', '560048'], ['Indiranagar', '560038'], ['Jakkur', '560064'], ['Jayanagar', '560041'],
  ['JP Nagar', '560078'], ['Kadubeesanahalli', '560103'], ['Kaggadasapura', '560093'], ['Kammanahalli', '560084'],
  ['Kanakapura Road', '560062'], ['Kasavanahalli', '560035'], ['Koramangala', '560034'], ['Krishnarajapuram', '560036'],
  ['Mahadevapura', '560048'], ['Malleshwaram', '560003'], ['Marathahalli', '560037'], ['Nagavara', '560045'],
  ['Panathur', '560103'], ['Rajajinagar', '560010'], ['Rajarajeshwari Nagar', '560098'], ['RT Nagar', '560032'],
  ['Sarjapur', '562125'], ['Sarjapur Road', '560035'], ['Thanisandra', '560077'], ['Ulsoor', '560008'],
  ['Varthur', '560087'], ['Vijayanagar', '560040'], ['Whitefield', '560066'], ['Yelahanka', '560064'],
];

export const BANGALORE_LOCALITIES: BangaloreLocality[] = AREAS.map(([area, pincode]) => ({
  id: area.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  area,
  city: 'Bengaluru',
  pincode,
}));