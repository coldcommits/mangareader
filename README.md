# mangareader

A userscript that spreads manga pages into a full spread for a more native reading experience. Does not download, copy or change any images.
**MAY NOT WORK ON SOME WEBSITES**

## Install

1. Install a userscript manager like [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/), either one works fine
2. Open the raw file and paste it in or upload to manager. [`two-page-spread.user.js`](https://raw.githubusercontent.com/coldcommits/mangareader/main/two-page-spread.user.js)
3. Click **Install** if your userscript manager prompts you.

## Use

1. Open a chapter page (the URL has to contain `chapter`).
2. Click the red **Spread** button in the bottom-right corner.

## Controls

| Input | Action |
|---|---|
| `←` / `→` | Turn the page |
| Click left / right side of the screen | Turn the page |
| `Space` / `Shift+Space` | Next / previous spread |
| `R` | Switch between right-to-left (manga) and left-to-right |
| `C` | Toggle whether the cover is shown alone or paired with page 2 |
| `Esc` | Close reader |
| `F` | Toggle fullscreen |

After  last spread, the next forward turn follows the page's "Next" link to the next chapter. Same thing for the previous chapter. It doesn't actually change the URL to the next chapter when you move past the last page. It fetches the images and loads it in the reader so you stay in fullscreen. When you exit the reader, then the next URL will load.
**may be broken depending on how the website is organized**

## Pairing

Pages paired in order. A wide image (width greater than height, so full page illustrations) should be always shown alone. If pairing seems weird (there no gap in the middle) press C to realign pages.

## Finding images

The script groups the page's `<img>` tags by their closest container and uses the largest one as the chapter so if it says it can't find images, or picks the wrong ones, edit `collectPages()` in the script to point at the right container.
**This may vary differing on the website used.**

## Notes

- Arrow keys, Space, `R`, `C` and `Esc` are overridden while the reader is open, so the site's own keyboard shortcuts don't work. If you don't want these you can easily disable them.
- Does not support manga piracy. Use tool at your own discretion.

## License

MIT
