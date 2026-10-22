# Journey postcards

The picture on the card you get when you reach a stop on a Journey
(`StopReachedModal.tsx`). Until a stop has one, the card shows a map of
where the stop is. Photos come first: `scripts/postcards/fetch.py`
takes each stop's picture from Wikipedia (free licences only, credit
shown under it) and writes `stopPictures.ts`. This is the brief for the
illustrated postcards that can replace any of them: the look, the specs,
and a scene for all 70 stops on the seven courses.

## The look

One style across all 70, so the gallery of places you've reached reads
as one set.

- **Flat vector illustration**, like a mid-century travel postcard:
  simple shapes, soft gradients allowed for sky and water, no outlines,
  no photo textures. The same family as the hound art in the app
  (rounded, friendly, a little chunky).
- **Palette:** warm and sunny. Use the app's accent purple `#9184d9` and
  gold `#e0b84f` somewhere small in every scene (a flag, a banner, a
  balloon, a jersey) so they tie to Hound; the rest is the place's own
  colours. Avoid pure black.
- **Light:** each course has one time of day, so its stops feel like one
  trip. Golden Gate: late-afternoon fog lifting. Windy City: bright
  morning. Five Boroughs: crisp autumn noon. Thames: soft grey-gold
  London light. Death Valley: dawn turning to white-hot midday, then
  evening at the Portal. Appalachian Trail: green summer, misty
  mornings. Route 66: big-sky afternoons into a Pacific sunset.
- **People:** small, few, always walking or cheering, never the main
  subject. A tiny hound is welcome in any scene (easter egg), never
  required.
- **No text in the image.** The caption, the stop's name and the mile
  are drawn by the app. No logos, no trademarks, no race branding.
- **Landmark first.** Every scene is recognisable from its landmark at
  thumbnail size, from across a room. One strong shape, not a vista of
  everything.

## Specs

| | |
|---|---|
| Size | 1200 × 816 px (the card crops nothing: it's drawn at that ratio) |
| Format | WebP, quality 80; aim for 40 to 80 KB each. (JPG at 85 is fine if WebP is awkward.) |
| Colour | sRGB |
| File | `mobile/assets/stops/<course-id>/<stop-slug>.webp`, names from the table below |
| Safe area | keep the landmark inside the middle 80 %: the postcard has a thin white border and a slight tilt |

Bundle cost: all 70 at about 60 KB is around 4 MB in the app. Fine for
a start; if it grows (photos), move them to Supabase storage and load on
demand, the manifest already takes a `{ uri }`.

## Putting them in

Photos: run `python3 mobile/scripts/postcards/fetch.py` (one course with
`--only windy-city`). It picks each stop's article from its own list,
keeps only CC0, public-domain, CC BY and CC BY-SA pictures, crops and
converts them, records the sources in `assets/stops/credits.json` and
regenerates `src/journeys/stopPictures.ts`. To swap a picture, change
the article (or give a `File:…` name from Commons) in the script and
run it again with `--force`.

Illustrations: drop the file in the folder above and point that stop's
entry in `stopPictures.ts` at it, without a credit. Or send the files to
Claude and it wires them.

## Generating them

If you use an image generator instead of an illustrator, paste the
style line once, then each stop's scene after it. Generate at 3:2 or
4:3 and crop to 1200 × 816. Keep the seed or style reference across a
course so the set matches; regenerate any that put text in the image.

**Style line:** *Flat vector travel-postcard illustration, mid-century
style, simple rounded shapes, soft gradients, no outlines, no text, no
logos, warm sunny palette with a small touch of lavender purple
(#9184d9) and gold (#e0b84f), small walking figures for scale, 3:2
landscape.*

## The stops

Slug, then the scene. Each is one landmark and one moment.

### Golden Gate Bridge (`golden-gate`), late afternoon, fog lifting

| Slug | Stop | Scene |
|---|---|---|
| `san-francisco-side` | San Francisco side | The south approach: the toll plaza's canopy and the first orange tower rising ahead, hills of the Presidio behind. |
| `south-tower` | South tower | Looking straight up the south tower from the sidewalk, cables fanning out, a slice of bay far below. |
| `midspan` | Midspan | The deck at the middle of the span, cables either side, the Pacific opening out to the left and a fog bank hovering. |
| `north-tower` | North tower | The north tower with the Marin Headlands' green-brown hills behind, fog spilling over them. |
| `vista-point` | Vista Point | From Vista Point: the whole bridge in profile, the bay, the city skyline small on the right, a few people at the railing. |

### Windy City 26.2 (`windy-city`), bright morning

| Slug | Stop | Scene |
|---|---|---|
| `grant-park` | Grant Park | Buckingham Fountain mid-spray, the skyline behind, a start-line crowd along Columbus Drive with balloons. |
| `lincoln-park` | Lincoln Park | The Lincoln Park Zoo entrance arch, a flamingo or two in the pond, trees, the skyline peeking behind. |
| `lakeview-turnaround` | Lakeview turnaround | Wrigley Field's red marquee and the corner of the park, a turnaround cone in the street, brownstones. |
| `halfway` | Halfway | A river bridge in the Loop with its bascule towers, the river green, glass towers both sides, an elevated train crossing behind. |
| `united-center` | United Center | The arena's long curved front and the Michael Jordan statue (as a leaping silhouette), banners. |
| `little-italy` | Little Italy | Taylor Street: a striped awning, a cafe table, a cup of Italian ice, lamp posts with tricolour flags. |
| `pilsen` | Pilsen | A corner building covered in a bold mural (sun, hands, flowers), a taqueria sign, papel picado overhead. |
| `chinatown` | Chinatown | The Chinatown gate across Wentworth Avenue, red and gold, a dragon lantern, the Pui Tak tower behind. |
| `bronzeville` | Bronzeville | The Monument to the Great Northern Migration (the bronze traveller with a suitcase) on its island, greystones behind. |
| `mount-roosevelt` | “Mount Roosevelt” | The long rise of the Roosevelt Road bridge seen from below, runners cresting it, the finish banners just visible beyond. |
| `finish-grant-park` | Finish, Grant Park | The finish arch on Columbus Drive, confetti, a medal held high, the lake behind. |

### Five Boroughs 26.2 (`five-boroughs`), crisp autumn noon

| Slug | Stop | Scene |
|---|---|---|
| `staten-island` | Staten Island | Fort Wadsworth's old stone battery with the Verrazzano's towers looming above, a cannon, the start crowd. |
| `brooklyn` | Brooklyn | Fourth Avenue in Bay Ridge: a long straight avenue, brownstones and bodegas, a church spire, crowds on both sidewalks. |
| `atlantic-avenue` | Atlantic Avenue | Barclays Center's rust-coloured curve and the oculus, the Williamsburgh Savings Bank tower behind. |
| `williamsburg` | Williamsburg | Bedford Avenue: a row of three-storey buildings, a water tower on a roof, the Williamsburg Bridge's grey towers at the end. |
| `halfway-into-queens` | Halfway, into Queens | The Pulaski Bridge's red railings, Newtown Creek below, Manhattan's skyline over the shoulder. |
| `queensboro-bridge` | Queensboro Bridge | Inside the bridge's cantilever ironwork, runners small in the lattice, the East River and Roosevelt Island below. |
| `first-avenue` | First Avenue | First Avenue from above: a canyon of apartment blocks, both sidewalks packed, flags and handmade signs. |
| `the-bronx` | The Bronx | The Willis Avenue Bridge's green steel and the Harlem River, a brick warehouse, a brass band on the corner. |
| `harlem` | Harlem | Fifth Avenue by Marcus Garvey Park: brownstone stoops, autumn trees, a church with its doors open and a choir on the steps. |
| `central-park` | Central Park | The park at 90th Street: the stone wall and gate, a hill of orange trees, the reservoir glinting. |
| `finish-central-park` | Finish, Central Park | The finish by Tavern on the Green: the blue arch, grandstands, trees in full colour, a foil blanket. |

### Thames 26.2 (`thames`), soft grey-gold light

| Slug | Stop | Scene |
|---|---|---|
| `greenwich-park` | Greenwich Park | The Royal Observatory on its hill with the red time ball, the heath below, the river and Canary Wharf far off. |
| `woolwich` | Woolwich | The Royal Arsenal's brick gatehouse and a ferry on the wide river. |
| `cutty-sark` | Cutty Sark | The Cutty Sark's black hull and gold trim in its glass dry dock, three masts, Greenwich's colonnades behind. |
| `tower-bridge` | Tower Bridge | Tower Bridge head-on from the road, blue and white, the towers and walkways above, runners streaming across. |
| `halfway` | Halfway | Wapping's old warehouses with their cranes and walkways over a cobbled street, the river glimpsed between. |
| `canary-wharf` | Canary Wharf | The glass towers of Canary Wharf around a dock, a DLR train on its viaduct, crowds on the quay. |
| `tower-of-london` | Tower of London | The White Tower's four turrets over the stone walls, a raven on the wall, a Beefeater's red tunic. |
| `big-ben` | Big Ben | The Elizabeth Tower and Parliament from Westminster Bridge, a red bus, the river. |
| `finish-the-mall` | Finish, The Mall | The Mall's red road lined with Union flags, Buckingham Palace at the end, the Victoria Memorial's gold angel. |

### Death Valley 135 (`death-valley`), dawn to white-hot midday to evening

| Slug | Stop | Scene |
|---|---|---|
| `badwater-basin` | Badwater Basin | The white salt flats' hexagon pattern stretching away, the mountains pink at dawn, the "sea level" sign high on the cliff. |
| `furnace-creek` | Furnace Creek | Date palms and the big thermometer sign reading very hot, a low adobe building, heat shimmer on the road. |
| `stovepipe-wells` | Stovepipe Wells | The Mesquite sand dunes' curves with the Panamint Range behind, a lone road sign. |
| `towne-pass` | Towne Pass | The road climbing in switchbacks to the pass summit sign, the valley floor far below and hazy. |
| `panamint-springs` | Panamint Springs | A small desert resort: gas pumps, a motel sign, a water tank, the long straight road west. |
| `keeler` | Keeler | A ghost town: a weathered wooden building and a rusted truck on the white dry lakebed, mountains behind. |
| `lone-pine` | Lone Pine | The Alabama Hills' rounded boulders and an arch, Mount Whitney's jagged crest behind, evening light. |
| `whitney-portal` | Whitney Portal | Pines and a waterfall at the trailhead, granite walls, the finish tape, cool blue dusk. |

### Appalachian Trail (`appalachian`), green summer, misty mornings

| Slug | Stop | Scene |
|---|---|---|
| `springer-mountain` | Springer Mountain | The bronze plaque and the first white blaze on a rock, rolling green ridges in morning mist. |
| `fontana-dam` | Fontana Dam | The tall concrete dam's curve with the lake behind it and the Smokies rising beyond. |
| `clingmans-dome` | Clingmans Dome | The concrete spiral observation tower above the trees, blue ridges fading into the distance. |
| `damascus` | Damascus | A small-town main street with a trail-town banner, bikes and backpacks on a porch, hills behind. |
| `mcafee-knob` | McAfee Knob | The famous rock ledge jutting over the valley, a hiker sitting on the edge, the valley far below. |
| `harpers-ferry` | Harpers Ferry | The old town's church steeple on the hill where two rivers meet, a railway bridge over the water. |
| `duncannon` | Duncannon | The Doyle Hotel's brick corner building with its turret, the Susquehanna behind. |
| `delaware-water-gap` | Delaware Water Gap | The river cutting through the ridge, forested walls either side, the bridge small in the gap. |
| `bear-mountain` | Bear Mountain | The stone tower on the summit with the Hudson's bend below and the bridge, a bear statue nodding to the zoo. |
| `mount-greylock` | Mount Greylock | The granite lighthouse-shaped war memorial tower on the summit above a sea of trees. |
| `hanover` | Hanover | A college green with a white clapboard church and brick halls, a white blaze on a lamp post on Main Street. |
| `mount-washington` | Mount Washington | The summit with its weather-station buildings and the cog railway, clouds tearing past, a wind-bent sign. |
| `monson` | Monson | A lakeside village with a general store and a canoe, the sign for the Hundred-Mile Wilderness. |
| `katahdin` | Katahdin | The wooden summit sign on Baxter Peak, a hiker's arms up, a sea of ridges and lakes below. |

### Route 66 (`route-66`), big-sky afternoons into a sunset

| Slug | Stop | Scene |
|---|---|---|
| `chicago` | Chicago | The "Begin" sign on Adams Street with the Art Institute's lions and the elevated tracks behind. |
| `springfield-il` | Springfield, IL | A drive-in with a corn dog on a stick on its sign, Lincoln's tall silhouette on a statue, prairie beyond. |
| `st-louis` | St. Louis | The Gateway Arch over the Mississippi, a riverboat, the old courthouse dome. |
| `joplin` | Joplin | A three-state corner: a small marker post, a red-brick downtown mural of the road, wheat fields. |
| `tulsa` | Tulsa | An art deco tower downtown and the Blue Whale of Catoosa grinning in its pond. |
| `oklahoma-city` | Oklahoma City | The red Round Barn in Arcadia and a shiny roadside pop stand with a giant soda bottle. |
| `amarillo` | Amarillo | Cadillac Ranch: ten tail-finned cars nose-down in a field, spray-painted in bright colours, a huge sky. |
| `albuquerque` | Albuquerque | Central Avenue's motel neon (a crescent-moon sign, an arrow), the Sandia mountains pink at sunset. |
| `flagstaff` | Flagstaff | Ponderosa pines, a railway crossing with a train, a downtown brick hotel sign, the Peaks behind. |
| `kingman` | Kingman | A classic gas station with round-top pumps, a Route 66 shield painted on the road, black hills. |
| `barstow` | Barstow | A long straight desert highway at golden hour, telephone poles, a truck stop sign, Joshua trees. |
| `santa-monica-pier` | Santa Monica Pier | The pier's "End of the Trail" sign, the Ferris wheel, palms, the Pacific and a sunset. |
