Read a UTF-8 text file from the local filesystem.

If the user gives a concrete text-file path, call Read directly—no Glob/`ls` pre-check. Missing paths return handleable errors. Not for directories (use Bash `ls` or Glob). Use Grep when the location is unknown.

When you need several files, prefer parallel Reads in one response instead of one file per turn.
