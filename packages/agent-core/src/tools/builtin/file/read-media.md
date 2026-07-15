Read image or video content from a file.

**Tips:**
- Follow each parameter description.
- A `<system>` tag precedes content: mime type, byte size, and for images original pixel dimensions. Prefer relative coordinates first; derive absolute coords from original size. After generating or editing media via commands/scripts, read the result back before continuing.
- The system notifies you on read errors.
- Prefer parallel reads — multiple files in one response when possible.
- Image/video only. To read text files, use the Read tool. Directories → `ls` via Bash or Glob.
- Missing/invalid paths return an error.
- Max size {{ MAX_MEDIA_MEGABYTES }}MB; larger files error.
- Returned media is directly viewable.

**Capabilities**
