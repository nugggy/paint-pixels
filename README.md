# Paint Pixels

A relaxing colour-by-numbers app for Android. Pick a picture, choose a colour and tap or drag across the matching numbered squares until the whole image appears.

## Features

- Over 1,000 pictures in 16 categories, including Australian birds and animals, parrots, butterflies, roses, orchids, fairy tales and Hokusai prints
- Three difficulty levels (Easy, Medium, Hard), based on grid size and number of colours
- Pinch to zoom, two-finger pan, double-tap to zoom, and drag-to-paint
- Long-press a square to pick up its colour, plus a hint button that finds the next square
- Six themes: Daylight, Midnight, Ocean, Blossom, Forest and Sunset
- Picture of the day, search, favourites, and progress saved automatically
- Share finished pictures as PNG images
- Checks GitHub for a new version each time it opens and offers the APK

## Install

Download the latest `PaintPixels-vX.Y.Z.apk` from [Releases](https://github.com/nugggy/paint-pixels/releases/latest) and open it on your Android phone. You may need to allow installs from your browser the first time. Later updates install over the top and keep your paintings.

## Picture sources and licences

Every picture is in the public domain, and each puzzle keeps a link to its original file. All of them come from [Wikimedia Commons](https://commons.wikimedia.org). Only files whose licence is recorded there as public domain or CC0 are used. The collections are:

- John Gould: *The Birds of Australia*, *The Mammals of Australia*, *The Birds of Asia*, *The Birds of New Guinea*
- Edward Lear: *Illustrations of the Family of Psittacidae, or Parrots*
- Levaillant, Lilford and Thorburn bird plates
- Hewitson and Hübner butterfly plates
- Bloch: *Ichtyologie*
- Pierre-Joseph Redouté: *Les Roses*, *Les Liliacées*, *Choix des plus belles fleurs*
- *Curtis's Botanical Magazine* (orchids), Thomé's *Flora von Deutschland* and *Köhler's Medizinal-Pflanzen*
- USDA Pomological Watercolor Collection
- Ernst Haeckel: *Kunstformen der Natur*
- Beatrix Potter, Walter Crane and Kate Greenaway illustrations, and Japanese fairy tale books
- Hokusai, Hiroshige and Kōno Bairei woodblock prints

`tools/candidates.mjs` lists the collections. `tools/build-puzzles.mjs` removes plain paper backgrounds and reduces each image to a pixel grid with a limited palette. `tools/rejects.txt` lists images removed after manual review.

## Development

```bash
npm install
npm run dev          # browser preview
npm run puzzles      # re-fetch candidates and rebuild public/puzzles (slow)
npm run android      # build web app and sync into the Android project
```

Tools: Node 22 or later, and JDK 21 plus the Android SDK for Android builds.

### Releasing a new version

1. Bump the version: `npm version patch` (or `minor` / `major`). This commits and tags `vX.Y.Z`.
2. Optionally add `release-notes.md` describing the changes. Otherwise notes are generated from commits.
3. Push with tags: `git push --follow-tags`.

GitHub Actions builds a signed APK and publishes it as a release. Installed apps see it the next time they open.

The workflow needs these repository secrets: `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS`. Keep a backup of the keystore. Without the same key, future updates cannot install over the existing app.

## Licence

Code is MIT licensed. The pictures are public domain or CC0, as described above.
