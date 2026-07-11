---
name: organize-workspace
description: Organizes your scattered files into logical folders by project, type, and purpose
metadata:
  author: Zo
  category: Official
  display-name: Organize my files
  emoji: 🗂️
catalogSource: luokai
catalogId: luokai-organize-workspace
---

Consolidate scattered files into logical directories to improve workspace organization and discoverability.

# Protocol

1. **Assess current workspace structure**
   - Catalog loose files in the workspace directory
   - Identify existing folder structure and naming conventions
   - Determine semantic relationships and project groupings before considering file types

2. **Identify semantic organization opportunities**
   - Group files by project, context, or domain first
   - Preserve existing directories that represent meaningful organization
   - Look for related items that should stay together despite different file types

3. **Protect special directories**
   - Identify any directories containing `file zosite.json` files, as well as any directories called `Articles` or `Prompts`
   - Do not touch, move, or reorganize these directories—they are managed project structures
   - Leave them in place regardless of other organizational changes

4. **Create organized folder structure** (if not already present):
   - `Projects/` – for active and completed projects
   - `Research/` – for articles, PDFs, and reference materials
   - `Data/` – for spreadsheets, CSVs, and datasets
   - `Documents/` – for notes, plans, and written content
   - `Archive/` – for old or completed items

5. **Consolidate files by semantic meaning, then by type**:
   - Prioritize grouping by project or context over pure file type
   - Move related files together into semantic folders when meaningful
   - Within semantic folders, organize by type if needed

6. **Organize supporting files**:

   **Projects/** – Project folders and related files
   - Move project directories and associated content into this structure

   **Research/** – Articles, PDFs, and reference materials
   - Move: PDF files, research documents, reference articles, and external content

   **Data/** – Spreadsheets and datasets
   - Move: CSV files, XLSX files, and other tabular data

   **Documents/** – Notes, plans, and written content
   - Move: Markdown files, text documents, planning documents, and analysis

   **Archive/** – Old or completed items
   - Move: Outdated files, deprecated versions, and completed projects

7. **Consolidate without destroying**:
   - Review existing subdirectories for related content and redundancies
   - Integrate contents into the appropriate semantic structure
   - Keep all original directories intact—do not delete any folders

8. **Ensure there are no remaining loose files in the workspace directory**

9. **Document the new structure**:
   - Create `file WORKSPACE_STRUCTURE.md` at the root explaining the folder organization

# Output

Inform the user that the workspace has been reorganized:

- List the new folder structure created
- Provide a count of files moved and their destinations
- Suggest next steps for navigating the reorganized workspace
- Note any files that required manual review or decisions about placement
- Ask the user if they have any organization preferences that they would like to use in the future, modifying this command

