Read image or video from a file.

- Params as described. A leading `<system>` tag has mime, bytes, and image original pixels — prefer relative coords; derive abs from original size. After generate/edit scripts, re-read before continuing.
- Prefer parallel reads. Image/video only; text → Read; dirs → Bash `ls` or Glob. Missing/invalid → error. Max {{ MAX_MEDIA_MEGABYTES }}MB. Media is directly viewable.
