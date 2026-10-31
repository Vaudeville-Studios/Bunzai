# Preroll symbol replacement

One asset per phrase. Generated with the built-in image_gen tool; no API/CLI. Each cutout uses true alpha. Text stays whole, with no clip masks. The symbol is the only artwork affected by the image-to-outline shader.

Asset destination: `docs/media/preroll-symbols/<slug>-v1.webp`.

Single timing owner: show decoded full-color symbol for 300ms, then one synchronized symbol-to-stencil impact and unmasked word slam. Hold each phrase at least 1000ms (first phrases around 1500ms; final YOURS 2200ms). Pause the entire timeline while hidden. Preserve curtain, skip, replay and reduced motion.

## Authoritative phrase mapping and exact prompt set

Shared prompt prefix:

```text
Use case: stylized-concept. Production transparent story-symbol cutout for Bunzai's kinetic theatrical title sequence. Create ONE isolated recognizable prop/emblem assemblage, no setting. Square composition, object occupies about 78% of canvas with at least 8% clear padding. True transparent alpha background, NOT black/white/checkerboard painted background. Slampunk theatrical manga screenprint / Danganronpa and Persona inspired cut-paper aesthetic: sharp deliberate angular silhouette, black ink outlines, layered colored paper, ivory cut edges, restrained halftone ONLY INSIDE the object, luxurious carefully composed graphic design. Preserve the subject's iconic colors. Readable at 180px. NOT photorealism, NOT 3D render, NOT a landscape, NOT a busy collage. No surrounding confetti, decorative shards, frame, caption, UI, watermark or unrelated objects. Transparent empty space surrounds the object. Subject: 
```

### 1. A STAGE

Story: The Wizard of Oz. Asset: `docs/media/preroll-symbols/oz-v1.webp`.

Subject prompt appended to prefix:

```text
A pair of Dorothy's sparkling ruby-red slippers, crossed at the heels, unmistakable curled vintage pumps with broad red bows.
```

### 2. A STORY

Story: Harry Potter. Asset: `docs/media/preroll-symbols/harry-potter-v1.webp`.

Subject prompt appended to prefix:

```text
Round black wire spectacles with a bold golden lightning-bolt scar floating immediately above the bridge, one unified emblem.
```

### 3. A DREAM

Story: Inception. Asset: `docs/media/preroll-symbols/inception-v1.webp`.

Subject prompt appended to prefix:

```text
The iconic small silver spinning top, tilted on its fine point, with a crisp elliptical ink motion stroke around the tip.
```

### 4. A SCENE

Story: The Phantom of the Opera. Asset: `docs/media/preroll-symbols/phantom-v1.webp`.

Subject prompt appended to prefix:

```text
The iconic ivory half-face opera mask, one sculptural asymmetric half mask with an empty black eye socket, angled slightly.
```

### 5. A CANVAS

Story: Howl's Moving Castle. Asset: `docs/media/preroll-symbols/howl-moving-castle-v1.webp`.

Subject prompt appended to prefix:

```text
Calcifer alone, the small mischievous orange-and-gold living flame with two large ivory eyes and a broad cheerful mouth, sitting on two small charcoal logs; one compact flame-character silhouette.
```

### 6. UNWRITTEN

Story: Death Note. Asset: `docs/media/preroll-symbols/death-note-v1.webp`.

Subject prompt appended to prefix:

```text
A black Death Note notebook, shut and at a slight diagonal, white hand-lettered title 'DEATH NOTE' on the cover, ragged white page edges.
```

### 7. UNCHARTED

Story: Uncharted. Asset: `docs/media/preroll-symbols/uncharted-v1.webp`.

Subject prompt appended to prefix:

```text
Nathan Drake's signature worn silver Francis Drake ring hanging from its dark leather necklace cord, ring in the foreground, cord makes one loose loop; abstract tiny engraving rather than readable lettering.
```

### 8. WIDE OPEN

Story: One Piece. Asset: `docs/media/preroll-symbols/one-piece-v1.webp`.

Subject prompt appended to prefix:

```text
Luffy's iconic golden straw hat with its vivid red hatband, angled so the broad brim and woven crown form one striking silhouette.
```

### 9. BOUNDLESS

Story: Back to the Future. Asset: `docs/media/preroll-symbols/back-to-future-v1.webp`.

Subject prompt appended to prefix:

```text
Marty McFly's iconic pink hoverboard alone, tilted diagonally, vivid pink deck with turquoise and lime geometric stripes, black foot strap, no wheels, no printed wordmarks.
```

### 10. WAITING

Story: Sleeping Beauty. Asset: `docs/media/preroll-symbols/sleeping-beauty-v1.webp`.

Subject prompt appended to prefix:

```text
One antique spinning-wheel spindle with a gleaming sharp needle and looping violet thread, recognizable enchanted spinning spindle, no wheel or room.
```

### 11. LISTENING

Story: The Little Mermaid. Asset: `docs/media/preroll-symbols/little-mermaid-v1.webp`.

Subject prompt appended to prefix:

```text
A single golden spiral conch shell necklace pendant on a short loop of dark cord, violet inner opening and warm gold shell, emblem of a captured voice.
```

### 12. WATCHING

Story: The Lord of the Rings. Asset: `docs/media/preroll-symbols/lord-of-the-rings-v1.webp`.

Subject prompt appended to prefix:

```text
The Eye of Sauron alone: a blazing orange-red catlike vertical iris ringed by jagged flame, no tower, no landscape, sharp almond silhouette.
```

### 13. WAKING

Story: The Matrix. Asset: `docs/media/preroll-symbols/matrix-v1.webp`.

Subject prompt appended to prefix:

```text
Two iconic red and blue capsules crossing diagonally as one emblem, each glossy highlight rendered as flat cream paper shapes, tiny green code-like hatching only inside the capsules.
```

### 14. SHIFTING

Story: Transformers. Asset: `docs/media/preroll-symbols/transformers-v1.webp`.

Subject prompt appended to prefix:

```text
A single Optimus Prime robot head cutout: angular blue helmet, silver faceplate, blue eyes and red side details; clean recognizable mechanical silhouette, no torso.
```

### 15. STIRRING

Story: Beauty and the Beast. Asset: `docs/media/preroll-symbols/beauty-and-beast-v1.webp`.

Subject prompt appended to prefix:

```text
One enchanted red rose under a clear bell-jar glass dome with a small dark base, a single fallen red petal inside; glass expressed with sparse ivory outline strokes, background genuinely transparent.
```

### 16. READY

Story: The Hunger Games. Asset: `docs/media/preroll-symbols/hunger-games-v1.webp`.

Subject prompt appended to prefix:

```text
The iconic gold mockingjay pin: small bird holding an arrow in its beak inside a golden circular ring, one worn-gold metallic emblem in flat graphic planes.
```

### 17. CALLING

Story: Batman. Asset: `docs/media/preroll-symbols/batman-v1.webp`.

Subject prompt appended to prefix:

```text
A compact black and brass Bat-Signal searchlight viewed three-quarter, circular lens showing a black bat silhouette on ivory, no projected beam, no skyline.
```

### 18. CHANGING

Story: Sailor Moon. Asset: `docs/media/preroll-symbols/sailor-moon-v1.webp`.

Subject prompt appended to prefix:

```text
Sailor Moon's iconic ornate pink-and-gold heart transformation compact, wing-like details and colored gemstone accents, one isolated magical brooch.
```

### 19. ALIVE

Story: Jurassic Park. Asset: `docs/media/preroll-symbols/jurassic-park-v1.webp`.

Subject prompt appended to prefix:

```text
One large translucent golden amber nugget with a crisp prehistoric mosquito trapped inside, rich honey-yellow and black silhouette, flat screenprinted highlights.
```

### 20. YOURS TO SHAPE

Story: Minecraft. Asset: `docs/media/preroll-symbols/minecraft-v1.webp`.

Subject prompt appended to prefix:

```text
One iconic Minecraft grass block, isometric cube with chunky pixel-like grassy emerald top and brown dirt sides, handcrafted paper-cut geometry and black ink edges.
```

### 21. YOURS TO DISCOVER

Story: The Legend of Zelda. Asset: `docs/media/preroll-symbols/zelda-v1.webp`.

Subject prompt appended to prefix:

```text
The Master Sword alone, vertical with slight diagonal tilt: blue-violet winged hilt, golden central jewel, long silver blade, no pedestal or scenery.
```

### 22. YOURS TO EXPLORE

Story: Star Trek. Asset: `docs/media/preroll-symbols/star-trek-v1.webp`.

Subject prompt appended to prefix:

```text
The USS Enterprise starship alone as a bold cut-paper object, saucer section, twin engine nacelles and slim secondary hull, three-quarter top view, ivory and cool-blue planes, no stars or space background.
```

### 23. YOURS TO BUILD

Story: The LEGO Movie. Asset: `docs/media/preroll-symbols/lego-movie-v1.webp`.

Subject prompt appended to prefix:

```text
One bright red LEGO-style building brick with eight circular studs, three-quarter isometric view, tactile paper-cut planes and thick black shadow edges; no printed wordmark.
```

### 24. YOURS TO IMAGINE

Story: The NeverEnding Story. Asset: `docs/media/preroll-symbols/neverending-story-v1.webp`.

Subject prompt appended to prefix:

```text
The Auryn amulet: two interlocked serpents, one warm gold and one silver, each biting the other's tail in the iconic oval knot, dark cord short loop.
```

### 25. YOURS TO CREATE

Story: Fullmetal Alchemist. Asset: `docs/media/preroll-symbols/fullmetal-alchemist-v1.webp`.

Subject prompt appended to prefix:

```text
One open State Alchemist silver pocket watch, ornate embossed alchemical bird crest on hinged lid, cream clock face and short dark chain, diagonal arrangement, no character or background.
```

### 26. YOURS TO WRITE

Story: Alan Wake. Asset: `docs/media/preroll-symbols/alan-wake-v1.webp`.

Subject prompt appended to prefix:

```text
A single vintage black mechanical typewriter with one ivory sheet in its roller; the paper is blank; moody angular black silhouette, cream keys, tiny red ribbon accent.
```

### 27. YOURS TO BECOME

Story: Pokémon. Asset: `docs/media/preroll-symbols/pokemon-v1.webp`.

Subject prompt appended to prefix:

```text
One iconic Poké Ball, red upper hemisphere, white lower hemisphere, black central belt and circular white button, angled slightly with bold clean silhouette.
```

### 28. YOURS TO PLAY

Story: Jumanji. Asset: `docs/media/preroll-symbols/jumanji-v1.webp`.

Subject prompt appended to prefix:

```text
A pair of weathered ivory Jumanji dice tumbling together, black pips and one deep green engraved spiral detail, sharp ivory paper-cut faces and dark ink edges; no board or scene.
```

### 29. YOURS TO HOLD

Story: Frozen. Asset: `docs/media/preroll-symbols/frozen-v1.webp`.

Subject prompt appended to prefix:

```text
One crystalline Elsa-like six-armed ice snowflake suspended alone, sculpted icy blue and white angular planes, crisp symmetrical frosty silhouette, no glow cloud or background.
```

### 30. YOURS TO TAKE

Story: Pirates of the Caribbean. Asset: `docs/media/preroll-symbols/pirates-caribbean-v1.webp`.

Subject prompt appended to prefix:

```text
Jack Sparrow's battered open brass compass, ornate dark compass dial, lid hinged upward, short leather loop, three-quarter angle, warm gold and black paper planes.
```

### 31. YOURS TO CONQUER

Story: Game of Thrones. Asset: `docs/media/preroll-symbols/game-of-thrones-v1.webp`.

Subject prompt appended to prefix:

```text
One dragon egg with overlapping dark emerald scales and bronze highlights, cracked narrowly at its crown with a tiny ember-red interior line, upright strong ovoid silhouette, no nest.
```

### 32. YOURS

Story: Bunzai. Asset: the existing Bunzai logo, reused without regeneration.

Subject prompt appended to prefix:

```text
Use the existing Bunzai logo asset; do not generate a replacement.
```
