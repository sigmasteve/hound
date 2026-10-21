// The courses you can walk as a Journey (0120_journeys.sql). Each is a
// line built from OpenStreetMap data (courseGeometry.ts, made by
// mobile/scripts/courses/build.py) and simplified to a few hundred points:
// close enough to recognise, not for navigation. Stops are the landmarks
// along the way, in course miles; your position is your miles along the
// line, scaled so its end is the course's full length.
//
// Names describe the place, not the event: "Windy City 26.2", never a
// race's own (trademarked) name.

import { COURSE_GEOMETRY } from './courseGeometry';

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

function geometry(id: string): Pick<Course, 'path' | 'water' | 'rivers'> {
  const g = COURSE_GEOMETRY[id];
  if (!g) throw new Error(`No geometry for course ${id}`);
  return g;
}

export const COURSES: Course[] = [
  {
    id: 'golden-gate',
    ...geometry('golden-gate'),
    name: 'Golden Gate Bridge',
    place: 'San Francisco',
    kind: 'landmark',
    miles: 1.7,
    blurb: 'Across the bridge, tower to tower. A first finish for anyone.',
    stops: [
      { mi: 0, name: 'San Francisco side' },
      { mi: 0.25, name: 'South tower' },
      { mi: 0.85, name: 'Midspan' },
      { mi: 1.35, name: 'North tower' },
      { mi: 1.7, name: 'Vista Point' },
    ],
    labels: [
      { at: [37.8078, -122.4835], text: 'SAN FRANCISCO' },
      { at: [37.833, -122.488], text: 'MARIN' },
    ],
  },
  {
    id: 'windy-city',
    ...geometry('windy-city'),
    name: 'Windy City 26.2',
    place: 'Chicago',
    kind: 'city',
    miles: 26.2,
    blurb: 'A loop through Chicago’s neighborhoods, starting and finishing in Grant Park.',
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
    labels: [{ at: [41.9, -87.6], text: 'LAKE MICHIGAN' }],
  },
  {
    id: 'five-boroughs',
    ...geometry('five-boroughs'),
    name: 'Five Boroughs 26.2',
    place: 'New York City',
    kind: 'city',
    miles: 26.2,
    blurb: 'Staten Island to Central Park through Brooklyn, Queens, the Bronx and Manhattan.',
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
    labels: [
      { at: [40.645, -73.965], text: 'BROOKLYN' },
      { at: [40.735, -73.99], text: 'MANHATTAN' },
    ],
  },
  {
    id: 'thames',
    ...geometry('thames'),
    name: 'Thames 26.2',
    place: 'London',
    kind: 'city',
    miles: 26.2,
    blurb: 'Greenwich to The Mall along the river, past Tower Bridge, Canary Wharf and Big Ben.',
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
    labels: [{ at: [51.515, -0.09], text: 'THE CITY' }],
  },
  {
    id: 'death-valley',
    ...geometry('death-valley'),
    name: 'Death Valley 135',
    place: 'California',
    kind: 'ultra',
    miles: 135,
    blurb: 'From the lowest point in North America to the foot of Mount Whitney.',
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
    labels: [{ at: [36.27, -117.15], text: 'DEATH VALLEY' }],
  },
  {
    id: 'appalachian',
    ...geometry('appalachian'),
    name: 'Appalachian Trail',
    place: 'Georgia to Maine',
    kind: 'trail',
    miles: 2190,
    blurb: 'Springer Mountain to Katahdin, across 14 states.',
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
    ...geometry('route-66'),
    name: 'Route 66',
    place: 'Chicago to Santa Monica',
    kind: 'trail',
    miles: 2448,
    blurb: 'The Mother Road, from Lake Michigan to the Pacific.',
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
