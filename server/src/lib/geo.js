const R = 6371; // km

const rad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in km between two {lat,lng} points. */
export function distanceKm(a, b) {
  if (!a || !b) return null;
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Areas we know coordinates for — powers the "pick a location" control. */
export const AREAS = [
  { name: 'Dhanmondi', lat: 23.7461, lng: 90.3742 },
  { name: 'Gulshan', lat: 23.7925, lng: 90.4078 },
  { name: 'Banani', lat: 23.7937, lng: 90.4066 },
  { name: 'Uttara', lat: 23.8759, lng: 90.3795 },
  { name: 'Mirpur', lat: 23.8223, lng: 90.3654 },
  { name: 'Mohammadpur', lat: 23.7654, lng: 90.3585 },
  { name: 'Bashundhara', lat: 23.8199, lng: 90.4267 },
  { name: 'Motijheel', lat: 23.7330, lng: 90.4172 },
  { name: 'Old Dhaka', lat: 23.7104, lng: 90.4074 },
  { name: 'Shahbagh', lat: 23.7381, lng: 90.3956 },
  { name: 'Badda', lat: 23.7806, lng: 90.4258 },
  { name: 'Tejgaon', lat: 23.7644, lng: 90.3936 },
];

export const CATEGORIES = [
  'Fiction',
  'Non-fiction',
  'Academic',
  'Science',
  'Business',
  'Self-help',
  'History',
  'Bangla Literature',
  'Comics & Graphic',
  'Children',
];
