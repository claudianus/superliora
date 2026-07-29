Read image or video from a file.

- Leading `<system>` tag has mime, bytes, image original pixels — prefer relative coords. After generate/edit scripts, re-read before continuing.
- Prefer parallel reads. Image/video only; text files use Read; dirs → Bash `ls` or Glob. Max {{ MAX_MEDIA_MEGABYTES }}MB.
