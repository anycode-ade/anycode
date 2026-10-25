# Multi-root workspaces

Anycode stores one workspace as a set of canonical project directories. The
backend owns that set and each project's Git and LSP runtime; selecting an
active project only changes the default for new actions on the selecting
Socket.IO connection. Existing editors, terminals, agents, searches, and file
operations keep their project association.

The project list and recent folders are persisted in
`~/.anycode/workspaces.json`. The backend restores valid project roots when it
starts. Older configurations containing only `current_workspace` are migrated
as a one-project workspace. A directory without a Git repository is still a
valid project and can be used for files and terminals.

## Folder access and security

In a web browser, the folder picker browses directories on the machine running
the Anycode backend. It does not access the browser user's local filesystem.
The picker and project-add request use the existing Socket.IO connection and
honor its token check when server authentication is configured; the backend
revalidates selected directories. No allowed-root restriction is currently
configured: a user who can access the backend can
browse directories readable by the backend process.

Terminals, language servers, and AI agents run as the backend process user.
Their working directories are set to the selected project's root, but terminal
and agent commands are **not sandboxed** and can access anything that user can
access. The folder picker is not an authorization boundary. For a server
reachable by other people, enable the existing server authentication and use
appropriate network and operating-system access controls; Anycode does not add
multi-user authorization or a per-project filesystem allow-list.

Desktop folder selection uses the native directory picker, then sends the
selected canonical path through the same backend project-add operation used by
the web picker. Opening or closing a project does not change the process
working directory. Removing a project is refused while it still owns running
terminals or agents; close those sessions explicitly first. Removing one
project does not stop sessions belonging to other projects.
