// The courses you can walk as a Journey (0120_journeys.sql). Each is a
// simplified line, hand-traced from public course maps and descriptions:
// close enough to recognise, not for navigation. Stops are the landmarks
// along the way, in course miles; your position is your miles along the
// line, scaled so its end is the course's full length.
//
// Names describe the place, not the event: "Windy City 26.2", never a
// race's own (trademarked) name.

export type LatLng = [number, number];

export type CourseKind = 'city' | 'ultra' | 'trail' | 'landmark';

export interface CourseStop {
  mi: number;
  name: string;
}

export interface Course {
  id: string;
  name: string;
  place: string;
  kind: CourseKind;
  miles: number;
  blurb: string;
  path: LatLng[];
  stops: CourseStop[];
  // Map context: water to shade, rivers to draw, place names.
  water?: LatLng[][];
  rivers?: LatLng[][];
  labels?: { at: LatLng; text: string }[];
}

export const COURSE_KIND_LABEL: Record<CourseKind, string> = {
  landmark: 'Quick wins',
  city: 'City 26.2s',
  ultra: 'Ultras',
  trail: 'Trails and roads',
};

export const COURSES: Course[] = [
  {
    id: 'golden-gate',
    name: 'Golden Gate Bridge',
    place: 'San Francisco',
    kind: 'landmark',
    miles: 1.7,
    blurb: 'Across the bridge, tower to tower. A first finish for anyone.',
    path: [
      [37.8077, -122.475],
      [37.8107, -122.4772],
      [37.8199, -122.4783],
      [37.8262, -122.4793],
      [37.8325, -122.481],
    ],
    stops: [
      { mi: 0, name: 'San Francisco side' },
      { mi: 0.25, name: 'South tower' },
      { mi: 0.85, name: 'Midspan' },
      { mi: 1.35, name: 'North tower' },
      { mi: 1.7, name: 'Vista Point' },
    ],
    water: [
      [
        [37.8128, -122.5],
        [37.8128, -122.455],
        [37.8248, -122.455],
        [37.8248, -122.5],
      ],
    ],
    labels: [
      { at: [37.8095, -122.462], text: 'SAN FRANCISCO' },
      { at: [37.829, -122.462], text: 'MARIN' },
    ],
  },
  {
    id: 'windy-city',
    name: 'Windy City 26.2',
    place: 'Chicago',
    kind: 'city',
    miles: 26.2,
    blurb: 'A loop through Chicago’s neighborhoods, starting and finishing in Grant Park.',
    path: [
      [41.8807, -87.6197], [41.889, -87.62], [41.892, -87.624], [41.892, -87.6282], [41.88, -87.628],
      [41.878, -87.628], [41.878, -87.6323], [41.89, -87.6323], [41.91, -87.633], [41.918, -87.631],
      [41.93, -87.636], [41.947, -87.644], [41.947, -87.646], [41.935, -87.644], [41.92, -87.637],
      [41.91, -87.634], [41.896, -87.634], [41.8794, -87.634], [41.8794, -87.65], [41.8794, -87.6747],
      [41.878, -87.6747], [41.878, -87.647], [41.869, -87.647], [41.8695, -87.66], [41.858, -87.66],
      [41.8578, -87.672], [41.853, -87.672], [41.853, -87.647], [41.853, -87.632], [41.837, -87.632],
      [41.837, -87.6264], [41.8312, -87.6264], [41.8312, -87.6234], [41.8674, -87.6243], [41.8674, -87.62],
      [41.8726, -87.62],
    ],
    stops: [
      { mi: 0, name: 'Grant Park' },
      { mi: 6.2, name: 'Lincoln Park' },
      { mi: 8, name: 'Lakeview turnaround' },
      { mi: 13.1, name: 'Halfway' },
      { mi: 14.5, name: 'United Center' },
      { mi: 17, name: 'Little Italy' },
      { mi: 19, name: 'Pilsen' },
      { mi: 21, name: 'Chinatown' },
      { mi: 23.5, name: 'Bronzeville' },
      { mi: 26, name: '“Mount Roosevelt”' },
      { mi: 26.2, name: 'Finish, Grant Park' },
    ],
    water: [
      [
        [41.96, -87.64], [41.945, -87.635], [41.93, -87.629], [41.912, -87.624], [41.897, -87.614],
        [41.889, -87.612], [41.878, -87.615], [41.866, -87.608], [41.856, -87.612], [41.842, -87.608],
        [41.825, -87.606], [41.825, -87.5], [41.96, -87.5],
      ],
    ],
    rivers: [
      [[41.8888, -87.612], [41.8875, -87.638], [41.896, -87.64], [41.91, -87.649]],
      [[41.8875, -87.638], [41.87, -87.638], [41.856, -87.642], [41.85, -87.656]],
    ],
    labels: [{ at: [41.9, -87.6], text: 'LAKE MICHIGAN' }],
  },
  {
    id: 'five-boroughs',
    name: 'Five Boroughs 26.2',
    place: 'New York City',
    kind: 'city',
    miles: 26.2,
    blurb: 'Staten Island to Central Park through Brooklyn, Queens, the Bronx and Manhattan.',
    path: [
      [40.6036, -74.0601], [40.6075, -74.0475], [40.615, -74.03], [40.64, -74.017], [40.66, -73.995],
      [40.683, -73.978], [40.689, -73.962], [40.705, -73.958], [40.723, -73.952], [40.74, -73.953],
      [40.748, -73.948], [40.757, -73.954], [40.762, -73.96], [40.79, -73.942], [40.802, -73.933],
      [40.806, -73.929], [40.812, -73.927], [40.81, -73.934], [40.803, -73.944], [40.788, -73.954],
      [40.775, -73.964], [40.768, -73.972], [40.766, -73.976], [40.768, -73.981], [40.7722, -73.9776],
    ],
    stops: [
      { mi: 0, name: 'Staten Island' },
      { mi: 2, name: 'Brooklyn' },
      { mi: 8, name: 'Atlantic Avenue' },
      { mi: 11, name: 'Williamsburg' },
      { mi: 13.1, name: 'Halfway, into Queens' },
      { mi: 15, name: 'Queensboro Bridge' },
      { mi: 16, name: 'First Avenue' },
      { mi: 20, name: 'The Bronx' },
      { mi: 21, name: 'Harlem' },
      { mi: 24, name: 'Central Park' },
      { mi: 26.2, name: 'Finish, Central Park' },
    ],
    rivers: [
      [[40.6, -74.045], [40.63, -74.04], [40.68, -74.02], [40.7, -74.0]],
      [[40.7, -74.0], [40.705, -73.975], [40.73, -73.97], [40.75, -73.96], [40.77, -73.945], [40.79, -73.935], [40.805, -73.93], [40.82, -73.932]],
    ],
    labels: [
      { at: [40.66, -74.04], text: 'BROOKLYN' },
      { at: [40.79, -73.99], text: 'MANHATTAN' },
    ],
  },
  {
    id: 'thames',
    name: 'Thames 26.2',
    place: 'London',
    kind: 'city',
    miles: 26.2,
    blurb: 'Greenwich to The Mall along the river, past Tower Bridge, Canary Wharf and Big Ben.',
    path: [
      [51.47, 0.01], [51.483, 0.035], [51.49, 0.065], [51.486, 0.03], [51.4826, -0.0096],
      [51.493, -0.04], [51.5, -0.055], [51.5055, -0.0754], [51.51, -0.06], [51.505, -0.02],
      [51.504, -0.018], [51.492, -0.015], [51.5, -0.008], [51.508, -0.023], [51.51, -0.05],
      [51.5085, -0.076], [51.51, -0.1], [51.507, -0.122], [51.5007, -0.1246], [51.501, -0.135],
      [51.5014, -0.1419], [51.5045, -0.135],
    ],
    stops: [
      { mi: 0, name: 'Greenwich Park' },
      { mi: 3, name: 'Woolwich' },
      { mi: 6.5, name: 'Cutty Sark' },
      { mi: 12.5, name: 'Tower Bridge' },
      { mi: 13.1, name: 'Halfway' },
      { mi: 18, name: 'Canary Wharf' },
      { mi: 22, name: 'Tower of London' },
      { mi: 25, name: 'Big Ben' },
      { mi: 26.2, name: 'Finish, The Mall' },
    ],
    rivers: [
      [
        [51.495, 0.075], [51.497, 0.03], [51.505, 0.005], [51.495, -0.005], [51.487, -0.01],
        [51.495, -0.03], [51.505, -0.035], [51.505, -0.05], [51.506, -0.075], [51.508, -0.088],
        [51.509, -0.105], [51.507, -0.118], [51.5, -0.122], [51.493, -0.12],
      ],
    ],
    labels: [{ at: [51.515, -0.09], text: 'THE CITY' }],
  },
  {
    id: 'death-valley',
    name: 'Death Valley 135',
    place: 'California',
    kind: 'ultra',
    miles: 135,
    blurb: 'From the lowest point in North America to the foot of Mount Whitney.',
    path: [
      [36.2297, -116.7675], [36.34, -116.83], [36.457, -116.866], [36.53, -117.0], [36.606, -117.145],
      [36.385, -117.29], [36.339, -117.468], [36.3, -117.6], [36.488, -117.874], [36.606, -118.063],
      [36.5869, -118.24],
    ],
    stops: [
      { mi: 0, name: 'Badwater Basin' },
      { mi: 17, name: 'Furnace Creek' },
      { mi: 42, name: 'Stovepipe Wells' },
      { mi: 58, name: 'Towne Pass' },
      { mi: 72, name: 'Panamint Springs' },
      { mi: 108, name: 'Keeler' },
      { mi: 122, name: 'Lone Pine' },
      { mi: 135, name: 'Whitney Portal' },
    ],
    labels: [{ at: [36.45, -116.95], text: 'DEATH VALLEY' }],
  },
  {
    id: 'appalachian',
    name: 'Appalachian Trail',
    place: 'Georgia to Maine',
    kind: 'trail',
    miles: 2190,
    blurb: 'Springer Mountain to Katahdin, across 14 states.',
    path: [
      [34.6266, -84.194], [35.451, -83.811], [35.5628, -83.4985], [36.0, -82.6], [36.633, -81.787],
      [37.392, -80.036], [38.03, -78.86], [39.3254, -77.7286], [40.397, -77.031], [40.974, -75.14],
      [41.312, -73.988], [42.637, -73.166], [43.702, -72.29], [44.2706, -71.3033], [45.286, -69.501],
      [45.9044, -68.9213],
    ],
    stops: [
      { mi: 0, name: 'Springer Mountain' },
      { mi: 165, name: 'Fontana Dam' },
      { mi: 200, name: 'Clingmans Dome' },
      { mi: 470, name: 'Damascus' },
      { mi: 710, name: 'McAfee Knob' },
      { mi: 1025, name: 'Harpers Ferry' },
      { mi: 1150, name: 'Duncannon' },
      { mi: 1295, name: 'Delaware Water Gap' },
      { mi: 1410, name: 'Bear Mountain' },
      { mi: 1580, name: 'Mount Greylock' },
      { mi: 1750, name: 'Hanover' },
      { mi: 1860, name: 'Mount Washington' },
      { mi: 2075, name: 'Monson' },
      { mi: 2190, name: 'Katahdin' },
    ],
    labels: [
      { at: [34.9, -82.3], text: 'GEORGIA' },
      { at: [45.4, -70.9], text: 'MAINE' },
    ],
  },
  {
    id: 'route-66',
    name: 'Route 66',
    place: 'Chicago to Santa Monica',
    kind: 'trail',
    miles: 2448,
    blurb: 'The Mother Road, from Lake Michigan to the Pacific.',
    path: [
      [41.8781, -87.6298], [39.7817, -89.6501], [38.627, -90.1994], [37.0842, -94.5133], [36.154, -95.9928],
      [35.4676, -97.5164], [35.222, -101.8313], [35.1717, -103.725], [35.0844, -106.6504], [35.5281, -108.7426],
      [35.1983, -111.6513], [35.1894, -114.053], [34.8481, -114.6141], [34.8958, -117.0173], [34.1083, -117.2898],
      [34.0094, -118.4973],
    ],
    stops: [
      { mi: 0, name: 'Chicago' },
      { mi: 200, name: 'Springfield, IL' },
      { mi: 300, name: 'St. Louis' },
      { mi: 580, name: 'Joplin' },
      { mi: 690, name: 'Tulsa' },
      { mi: 800, name: 'Oklahoma City' },
      { mi: 1060, name: 'Amarillo' },
      { mi: 1370, name: 'Albuquerque' },
      { mi: 1700, name: 'Flagstaff' },
      { mi: 1860, name: 'Kingman' },
      { mi: 2150, name: 'Barstow' },
      { mi: 2448, name: 'Santa Monica Pier' },
    ],
  },
];

export function courseById(id: string): Course | undefined {
  return COURSES.find((c) => c.id === id);
}

// ── Where you are ────────────────────────────────────────────────────

const R = 3958.8;
const rad = (d: number) => (d * Math.PI) / 180;

function haversine(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const cumulative = new Map<string, number[]>();
function cum(course: Course): number[] {
  let c = cumulative.get(course.id);
  if (!c) {
    c = [0];
    for (let i = 1; i < course.path.length; i++) c.push(c[i - 1] + haversine(course.path[i - 1], course.path[i]));
    cumulative.set(course.id, c);
  }
  return c;
}

// The point `miles` along the course (clamped to its ends).
export function pointAt(course: Course, miles: number): LatLng {
  const c = cum(course);
  const d = (Math.max(0, Math.min(1, miles / course.miles)) * c[c.length - 1]);
  let i = 1;
  while (i < c.length - 1 && c[i] < d) i++;
  const t = (d - c[i - 1]) / (c[i] - c[i - 1] || 1);
  const a = course.path[i - 1];
  const b = course.path[i];
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

// The course from the start to `miles`.
export function pathTo(course: Course, miles: number): LatLng[] {
  const c = cum(course);
  const d = Math.max(0, Math.min(1, miles / course.miles)) * c[c.length - 1];
  const out: LatLng[] = [course.path[0]];
  for (let i = 1; i < course.path.length && c[i] <= d; i++) out.push(course.path[i]);
  out.push(pointAt(course, miles));
  return out;
}

// The next stop ahead, or null once you've finished.
export function nextStop(course: Course, miles: number): CourseStop | null {
  return course.stops.find((s) => s.mi > miles) ?? null;
}

// Stops passed so far (not counting the start).
export function stopsPassed(course: Course, miles: number): CourseStop[] {
  return course.stops.filter((s) => s.mi > 0 && s.mi <= miles);
}

export function formatMiles(miles: number): string {
  return miles >= 100 ? Math.round(miles).toLocaleString('en-US') : (Math.round(miles * 10) / 10).toString();
}
