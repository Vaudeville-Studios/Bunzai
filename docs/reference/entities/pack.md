---
id: reference/entities/pack
title: Pack entity
audience: dev
summary: The canonical studio entity for a reusable expression/sprite pack: every PackBody field, its type, and its meaning.
tags: [entity, pack, canonical, fields]
related: [reference/architecture, reference/entities/character]
---

# Pack entity

A `CanonicalPack` is `CanonicalEntity<"pack", PackBody>`: the same stable canonical wrapper (see
[architecture.md](../architecture.md)) every entity uses, around a `PackBody`. `src/entities/pack/schema.ts`
is the source of truth for the `PackBody` type; this page is the source of truth for what each field means.

Pack is also the canonical target of the `image-pack` adapter. It reads a ZIP of supported pictures and
sounds, or a single supported raster image, into one reusable pack. A pack is stored at
`studio/pack/<id>.json` and can be attached to more than one character. The adapter does not define
external pack fields in the formats coverage matrix ([formats/README.md](../formats/README.md)); its
input is normalized directly into the canonical pack shape.

## How to read the field table

The field table on this page is generated from the schema by `scripts/docs-fields.ts` and embedded
verbatim. Do not hand-edit a cell: improve the schema doc comment and regenerate, and the docs follow.

- **Field** is the canonical name. A trailing `?` marks an optional field.
- **Type** is the TypeScript type in the schema.
- **Producers** are the source formats named in the field's schema doc comment. A `-` means the schema
  does not list a field-specific producer; the `image-pack` adapter still creates a canonical pack
  from its supported import files.
- **Meaning** is what the field is for. A blank Meaning cell is a self-evident primitive named by its own
  field; none occur on this page. Any richer explanation lives in the prose around the table, never
  inside a cell.

## Composition

`PackBody` stays flat: a `name`, an optional shelf `brief`, the `pack` itself, and an optional multi-character
`groups` map. There are no always-present sub-objects to group the way `CharacterBody` has eight: the
whole body is one small record. `pack` and each entry of `groups` are a `SpritePackValue`, the label-to-image
hub shape a character's `media.assets` (role `emotion`) project through as well; see
[entities/character.md](character.md), "Media". `SpritePackValue` and its `SpritePackItem` rows live in
`src/core/media/pack.ts`, not in `src/entities/pack/schema.ts`, so `scripts/docs-fields.ts` does not generate
a table for them on this page; they are described in prose below, in "The sprite pack hub shape".

@fig composition

The table below is pasted verbatim from [docs/generated/fields.pack.md](../../generated/fields.pack.md).

## Pack body

| Field | Type | Producers | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | - | Library / tab name |
| `brief?` | `string` | - | Short blurb on the shelf card (never host wire) |
| `pack` | `SpritePackValue` | - | The emotion pack (label -> image). Hub shape shared with character media. |
| `groups?` | `Record<string, SpritePackValue>` | - | Optional multi-character groups (per-character); flat pack is the default group. |

## The sprite pack hub shape

`SpritePackValue` (`src/core/media/pack.ts`) is the label-to-image hub every pack-shaped field converts
through, on a character card and in the library alike:

- `items: SpritePackItem[]`, the faces. Each item is `{ id: string; label: string; ref: string; mime?:
  string }`: a stable id, the display label ("neutral", "happy", ...), a `ref` into the entity's asset
  store or a data URI, and an optional mime type.
- `enabled?: boolean`, a creator on/off toggle for the pack as a whole.
- `defaultLabel?: string`, which face is the resting/default face. `resolvePackFace` falls back to a
  face literally labelled "neutral", then to the first item, when this is absent or matches nothing.

A pack is not only pictures. An item whose media type is audio is a sound file, and the Stage wing's Music tab plays the sounds in the person's packs (a pack stands where RoleCall
has a category). The same item shape holds it, with `mime` an `audio/*` type: mp3, ogg, m4a, wav, flac or aac, sniffed from the bytes when it is added, and held to the media cap
of 32 MiB (`ASSET_MAX_BYTES`, `src/core/media/limits.ts`), not the 10 MiB picture limit. A sound is served from `/api/asset/<sha>`, which answers `Range` requests (206 with `Content-Range`, 416 for a range past the end, `Accept-Ranges: bytes`) so a browser can seek.
The store seals each file as one cell, so a range is cut from a single read bounded by that cap, not read from disk piece by piece; a 416 reads nothing (it is answered from the stored size), and a store that cannot report a size ignores Range and sends the whole file. Printing a pack writes its sounds
under the same cap, and importing the zip reads them back byte for byte: the image-pack codec and the pack editor's zip door take pictures (png, jpg, gif, webp, up to 10 MiB each)
and sounds (`PACK_SOUND_EXTENSIONS`, up to 32 MiB each), and a zip holding anything else is still not claimed. The pack editor draws a sound as a note glyph. Sounds are admitted by
extension and size on the inline path, and sniffed from their bytes when the editor stages them.

This is the same shape `packFromMedia` reads off a character's `media.assets` (role `emotion`) and
`emotionAssetsFromPack` writes back onto, so a face pack means the same thing whether it lives on a
character card or as a standalone library `pack` entity.

`groups?: Record<string, SpritePackValue>` holds one full `SpritePackValue` per named group member,
keyed by that member's name: a multi-character scene, Lumiverse's `expression_groups` block
(`src/formats/_shared/media-bridge/lumi-expressions.ts`). When `groups` is absent or empty, `pack` alone
is the default group.

## What rides escrow, not a field

The `image-pack` adapter records imported member filenames in its `original` entry. The media bytes
themselves become canonical item refs; the ZIP container is not retained. Studio-created packs still
start as a bare `CanonicalEntity<"pack", PackBody>` with no `original` entry.

The only imported escrow is the list of filenames used by the image-pack import. It is descriptive
metadata, not the source bytes or a promise of byte-identical container output.

Does NOT ride escrow, because there is nothing for it to carry: an item's `ref` (a data URI, or a
reference into the entity's asset store) is the image itself, authored inline, not a binary carrier kept
beside a canonical field the way a character's PNG `sourceMedia` carrier is. See architecture.md,
"Binary carriers", for the contrast.

## See also

- [architecture.md](../architecture.md): the canonical model, the adapter contract, escrow.
- [entities/character.md](character.md): the `Media` section, and the character-attached form of this
  same `SpritePackValue` hub shape.
- [formats/README.md](../formats/README.md): the coverage matrix; pack import normalizes files directly
  into the studio-native canonical shape rather than claiming external field coverage.
