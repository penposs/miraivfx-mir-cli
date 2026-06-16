# Safety Model

`mir-cli` is designed to help users and AI assistants organize Miraivfx canvases while keeping the user in control.

## Login

- Users sign in through the browser.
- The CLI never asks users to type passwords into the terminal.
- Agents must not ask users to paste raw tokens or private credentials.

## Canvas Changes

- Commands that change the canvas require explicit confirmation flags such as `--yes`.
- Upload commands require `--allow-upload`.
- Node edits use small canvas operations: add, update, clone, delete, connect, and disconnect.
- Agents should inspect the current canvas before editing existing nodes.
- Agents should use exact node ids for updates and deletes.

## Recommended Agent Behavior

- Prefer `clone` for creative iterations so the original node stays visible.
- Use `update` only when the user asks to edit the original node.
- Upload each unique asset once and reuse it with connections.
- Keep layouts readable and leave room for future result nodes.
- Summarize destructive changes before deleting nodes.

## User-Controlled Generation

- The CLI prepares the canvas.
- Users review the canvas in Miraivfx.
- Generation, task review, and result downloads happen in the Miraivfx web app.

## Do Not Do This

- Do not ask users for passwords.
- Do not ask users to paste tokens.
- Do not try to control anything outside the user's Miraivfx canvas workflow.
- Do not write hidden system fields into nodes.
