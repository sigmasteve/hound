import type { ImageSourcePropType } from 'react-native';
import type { Course, CourseStop } from './courses';
import { STOP_PICTURES } from './stopPictures';

// What's at each stop, in a line: the words on the postcard you get when
// you reach it (StopReachedModal). Keyed by course id and stop name.

const NOTES: Record<string, Record<string, string>> = {
  'golden-gate': {
    'San Francisco side': 'The toll plaza behind you, 1.7 miles of orange steel ahead.',
    'South tower': '746 feet up. Engineers said a bridge here couldn’t be built.',
    Midspan: '220 feet above the Golden Gate. Look left: that’s the Pacific.',
    'North tower': 'Marin’s side. The fog usually rolls in right here.',
    'Vista Point': 'Turn around: the whole bridge, the bay and the city skyline.',
  },
  'windy-city': {
    'Grant Park': 'Buckingham Fountain, the lake, and a whole city waiting.',
    'Lincoln Park': 'The zoo is just off to your left, and it’s free.',
    'Lakeview turnaround': 'Wrigley Field is two blocks west. Time to head back south.',
    Halfway: 'Downtown again, with the river and the skyline all around you.',
    'United Center': 'The Bulls’ house. Michael Jordan’s statue is out front.',
    'Little Italy': 'Taylor Street. Italian ice on a hot day is the local tradition.',
    Pilsen: 'Murals on every wall, and the best tacos on the course.',
    Chinatown: 'Through the gate on Wentworth, past the dragons.',
    Bronzeville: 'The old heart of Black Chicago. The Great Migration monument stands here.',
    '“Mount Roosevelt”': 'The course’s one hill, right before the finish. It’s a bridge.',
    'Finish, Grant Park': 'Columbus Drive, the crowd, the medal. You did it.',
  },
  'five-boroughs': {
    'Staten Island': 'Fort Wadsworth, the old cannons, and the Verrazzano ahead.',
    Brooklyn: 'Over the Narrows into Bay Ridge. Fourth Avenue runs for miles.',
    'Atlantic Avenue': 'Barclays Center on your right. Brooklyn’s loudest crowds live here.',
    Williamsburg: 'Bedford Avenue: brownstones, bridges and a sudden quiet.',
    'Halfway, into Queens': 'The Pulaski Bridge, with Manhattan over your left shoulder.',
    'Queensboro Bridge': 'The silent mile: no crowds on the bridge, then a wall of noise.',
    'First Avenue': 'Six lanes wide and cheering for sixty blocks, all the way to Harlem.',
    'The Bronx': 'The Willis Avenue Bridge. One mile here and you’ve done all five boroughs.',
    Harlem: 'Fifth Avenue south past Marcus Garvey Park, with the choirs out.',
    'Central Park': 'Into the park at 90th Street. The hills are real.',
    'Finish, Central Park': 'Tavern on the Green. The finish of the world’s biggest race.',
  },
  thames: {
    'Greenwich Park': 'Blackheath, the Royal Observatory and the meridian line.',
    Woolwich: 'The Royal Arsenal, where the river turns east.',
    'Cutty Sark': 'The last of the tea clippers, in dry dock since 1954.',
    'Tower Bridge': 'The course’s picture: over the river with the towers above you.',
    Halfway: 'Wapping and the old docks, with Canary Wharf ahead.',
    'Canary Wharf': 'The Isle of Dogs’ glass towers. The crowds pack the quayside.',
    'Tower of London': 'Nine hundred years old. The ravens are still there.',
    'Big Ben': 'Westminster Bridge and Parliament. The finish is in sight.',
    'Finish, The Mall': 'Buckingham Palace behind you, The Mall under your feet.',
  },
  'death-valley': {
    'Badwater Basin': '282 feet below sea level. The lowest point in North America.',
    'Furnace Creek': 'Where the hottest temperature on Earth was recorded: 134°F in 1913.',
    'Stovepipe Wells': 'Sand dunes on one side, the Panamint Range on the other.',
    'Towne Pass': '4,956 feet up and out of the valley at last.',
    'Panamint Springs': 'A gas station, a motel and a very long road west.',
    Keeler: 'The ghost of a mining town on the dry bed of Owens Lake.',
    'Lone Pine': 'The Alabama Hills, where the westerns were shot, and Mount Whitney above.',
    'Whitney Portal': '8,360 feet. The foot of the highest peak in the lower 48.',
  },
  appalachian: {
    'Springer Mountain': 'The southern end. 2,190 miles of white blazes ahead.',
    'Fontana Dam': 'The tallest dam east of the Rockies, and the Smokies ahead.',
    'Clingmans Dome': '6,643 feet, the highest point on the whole trail.',
    Damascus: 'Trail Town USA. Trail Days fills it every May.',
    'McAfee Knob': 'The most photographed spot on the trail. Sit on the ledge.',
    'Harpers Ferry': 'The halfway point in spirit, and the trail conservancy’s front door.',
    Duncannon: 'The Doyle Hotel, and the rocks of Pennsylvania begin.',
    'Delaware Water Gap': 'The river cuts clean through the ridge. New Jersey next.',
    'Bear Mountain': 'The trail’s lowest point, straight through the zoo.',
    'Mount Greylock': 'Massachusetts’ highest, with a lighthouse on top.',
    Hanover: 'Dartmouth College. The trail runs right down Main Street.',
    'Mount Washington': 'Home of the world’s worst weather: 231 mph winds, once.',
    Monson: 'The last town. The Hundred-Mile Wilderness starts here.',
    Katahdin: 'Baxter Peak, the end. The sign is right there.',
  },
  'route-66': {
    Chicago: 'The Begin sign on Adams Street. 2,448 miles to the Pacific.',
    'Springfield, IL': 'Lincoln’s hometown, and the Cozy Dog Drive In’s corn dog on a stick.',
    'St. Louis': 'The Gateway Arch, with the Mississippi behind it.',
    Joplin: 'Three states in a few miles: Missouri, Kansas, Oklahoma.',
    Tulsa: 'Art deco downtown, and the Blue Whale of Catoosa up the road.',
    'Oklahoma City': 'The middle of the Mother Road. The Round Barn in Arcadia is behind you.',
    Amarillo: 'Cadillac Ranch: ten cars nose-down in a field.',
    Albuquerque: 'Central Avenue neon, and the Sandias turning pink at sunset.',
    Flagstaff: 'Pine country at 7,000 feet, with the Grand Canyon up the road.',
    Kingman: 'Then the Black Mountains and the hairpins down to Oatman.',
    Barstow: 'The Mojave crossing is done.',
    'Santa Monica Pier': 'End of the Trail. The Pacific.',
  },
};

export function stopNote(course: Course, stop: CourseStop): string | null {
  return NOTES[course.id]?.[stop.name] ?? null;
}

// The picture on a stop's postcard: a photo from Wikipedia, fetched and
// cropped by mobile/scripts/postcards/fetch.py into stopPictures.ts, with
// its credit line (shown under it). A stop without one shows a map of
// where it is instead (StopReachedModal). An illustrated postcard can
// take a photo's place in the manifest the same way, without a credit.
export interface StopPicture {
  source: ImageSourcePropType;
  credit?: string;
}

export function stopPicture(course: Course, stop: CourseStop): StopPicture | null {
  return STOP_PICTURES[course.id]?.[stop.name] ?? null;
}
