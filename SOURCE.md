# Initial source provenance

The initial browser controls are byte-for-byte extracts of ComfyAssets' own
KikoTools modules at commit `1820fb19ea5d200e8cd2a09bcbbcc35926f13228`.
KikoTools remains unchanged by this extraction. Future toolkit changes belong
here and are validated in PromptManager before a later KikoTools adoption PR.

| Toolkit file | KikoTools source | SHA-256 |
| --- | --- | --- |
| `ui/core.js` | `web/ui/core.js` | `cd10b700441a607cb1d56051cf0a430c0b36f901c0c351d8f4dae067090d8838` |
| `ui/controls.css` | `web/ui/controls.css` | `64d6b0f3059b0a21187796059fe14bfb5358a796a18f775543b7baef43874e80` |

Host orchestration and coverage helpers were extracted and generalized from
KikoTools' maintainer tooling, with isolated tracked-file installation and a
project preparation adapter proven against PromptManager. They have no runtime
imports from either node pack. All original code retains the ComfyAssets MIT
license. No Pixaroma implementation, styles or assets were copied.
