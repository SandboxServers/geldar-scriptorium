# Troubleshooting

Every message geldar-play prints has a section below, named by its key in `launcher/messages.d`. A message is printed as `geldar-play: <text>` on stderr. Messages that are not errors are in the table below; every other key has its own section.

## Not a problem

| Key | What it is |
|---|---|
| `usage` | The command line was not in a form the launcher accepts. It prints the usage line and exits, and nothing ran. |
| `created` | The player's repository was made. The message names the next command, `setup`. |
| `created_seeded` | The player was made from the persona you gave. It is already born, so `setup` is not needed; the next command is `play`. |
| `public_notice` | The player's repository is public, memory included. This is information, not a failure. |
| `mock_note` | The player was made with --mock. A mock player plays only through the dev-world setting (GELDAR_DEV_MCP_URL) or a world.conf whose `mcp_base` is the mock's address. This is information, not a failure. |
| `many_players` | More than three players were started together. Each one uses your plan's limits, so start with one and watch. |
| `dev_world_active` | GELDAR_DEV_MCP_URL is set and valid, so this launch uses a world on your machine. The message repeats the URL. See the testing section. |
| `session_start` | A session is starting. Closing it saves the player's memory. |
| `session_end` | The session has ended. |
| `start_recorded` | The launch starts from the commit named in the message. |
| `recovering` | The last session ended before its memory was saved, and the launcher is saving it now. |
| `stale_cleared` | The workspace of an earlier session is gone, so its leftover state was cleared. |
| `saved` | The memory was saved. The message gives the number of commits. |
| `nothing_to_save` | The session made no changes, so there was nothing to save. |
| `resolved` | The held session was already saved, and its leftovers were cleaned up. |
| `archived` | The player was archived on GitHub and removed from this machine. Your own folder was left alone. |
| `verify_ok` | The check of the session passed, and saving carries on. |
| `upgrade_current` | The kit in the player is already this version, so nothing was changed. |
| `upgrade_done` | The kit upgrade is ready as a pull request. Memory was not touched. Review the pull request before you merge it. |

## The world address and port

`mcp_port` in `launcher/config/world.conf` is the port of the world's MCP, set by the owner. It holds digits only, from 1024 to 65535, with no leading zero. On every port, the host of a player's server address must equal the host of `mcp_base`. Ports 80 and 443 are accepted only on that host, and any other port must also equal `mcp_port`. Blank means only ports 80 and 443 are accepted, and still only on the `mcp_base` host. When it is set, `mcp_base` carries the same port, for example `https://world.example:18443`.

A refused port is a refusal on purpose. The launcher sends a session only to the address and port the owner named, so a world URL with any other port is refused as `bad_url`, and nothing is created or contacted.

## Testing against a world on your own machine

Set GELDAR_DEV_MCP_URL, in the shell that runs geldar-play only, to exactly `http://host.docker.internal:PORT/p/ID`. PORT is from 1024 to 65535 with no leading zero, and ID is the player's id. The launcher reads the value from the environment only, never from player.json or a file. Its one check is that exact shape, and a wrong value is refused as `dev_world_bad`. The value is not checked against `mcp_base`, it goes straight to the allowlist for that launch, and it is unset for the container.

On Linux, `host.docker.internal` maps to `host-gateway` for the proxy only. That is the Docker bridge address, not 127.0.0.1, so your test server must listen on the bridge address to be reached. A server that listens on every address (the wildcard address) can be reached by other machines on your LAN, so bind it to the bridge address only.

The token travels in clear text over http. Use a separate dev token that only the test world accepts, and never the real world's token.

Each launch prints `dev_world_active` with the URL as a loud reminder that this is a local world. To switch it off, unset GELDAR_DEV_MCP_URL in that shell. While it is set, starting more than one player is refused with `dev_world_single`.

## Messages

### not_yet
What it means. The verb you asked for is not available in this build of geldar-play.
Why it is safe. The launcher stops before it touches any player, so nothing was run or changed.
What to do. Use a verb the README lists.

### bad_player_id
What it means. The player id is not valid. Use lowercase letters, digits and dashes, starting with a letter.
Why it is safe. The launcher checks the id before it looks for any folder, so nothing was read or changed under that name.
What to do. Run the command again with a valid id.

### no_such_player
What it means. There is no player with that id on this machine.
Why it is safe. The launcher only reads the state folder for the id, and it did not create anything.
What to do. Check the spelling, or create the player with the command the message prints.

### locked
What it means. A launch for this player holds its lock. It is running now, or an earlier launch stopped halfway.
Why it is safe. The lock stops two launches from using the same player at once, so the launcher refused to start.
What to do. Close the other session, then try again.

### locked_stale
What it means. The launch that held the lock is gone, but its lock folder was left behind.
Why it is safe. The launcher does not delete the folder itself. It names the folder, so you decide.
What to do. If you are sure nothing is running, remove the folder the message names, then try again.

### missing_tool
What it means. A program the command needs is not installed or is not on the PATH. The message names it and gives a hint.
Why it is safe. The launcher checks for every tool before it starts, so nothing was started.
What to do. Install the named program as the hint says, then try again. Docker also needs Compose v2.

### git_too_old
What it means. The git on this machine is older than 2.40, which the launcher needs.
Why it is safe. The launcher checks the version first and stops, so nothing was started.
What to do. Install git 2.40 or newer, then try again.

### internal_only
What it means. You asked for a verb that is reserved for the launcher's own tests.
Why it is safe. The verb is refused unless the internal test switch is set, so it is not reachable by accident.
What to do. Use the verbs the README lists.

### cli_unsupported
What it means. You asked for the Codex CLI, which is not available yet.
Why it is safe. The launcher refuses the option before it starts anything. Only Claude Code runs in this version.
What to do. Run with Claude Code.

### image_unsafe
What it means. The test switch GELDAR_UNSAFE_IMAGE is set, so the launcher is using a kit image that is not pinned by digest.
Why it is safe. This only happens when the internal test switch is also set to 1. A normal run never uses an unpinned image.
What to do. Unset GELDAR_UNSAFE_IMAGE. Use it only in tests.

### image_refused
What it means. The kit image is not pinned by digest, so the launcher did not use it.
Why it is safe. Only an image pinned by digest may run, so the launcher stopped before it started a container.
What to do. Use the released kit image that the launcher configuration names by digest.

### held
What it means. The last session for this player is held. Its memory was not saved, and the message gives the reason.
Why it is safe. The held session is kept, not discarded. The launcher never merges it, and it refuses every launch of this player until the session is resolved.
What to do. Read the reason, then run the resolve command the message prints.

### already_born
What it means. setup already wrote this player's identity, and setup runs only once.
Why it is safe. The launcher refused to overwrite the identity, so the existing one is unchanged.
What to do. Nothing. Run play.

### bad_branch
What it means. The branch recorded for this player is not an allowed name, or the record is missing.
Why it is safe. The launcher refused to start, so no branch was checked out or pushed.
What to do. Correct the recorded branch name to a valid one, then try again.

### export_symlink
What it means. The committed kit files of the player hold a link where a file belongs.
Why it is safe. The launcher will not export a link into the workspace, so nothing was started.
What to do. Replace the link with the real file in the player's repository, commit it, then try again.

### export_attributes
What it means. The player's repository has an attribute that changes how the kit is exported.
Why it is safe. Such a rule would make the exported kit differ from the one that was reviewed, so the launcher stopped.
What to do. Remove the export-ignore or export-subst rule from the repository, commit, then try again.

### bad_state_path
What it means. The folder that holds this player's state has a name the launcher cannot use safely, because it has control characters, a comma or a colon.
Why it is safe. Those characters cannot be passed to the container mounts safely, so nothing was started.
What to do. Move the state folder to a path without those characters. GELDAR_STATE_DIR sets where it is kept.

### dirty
What it means. Your copy of the player has changes that are not saved in git.
Why it is safe. The launcher will not start over uncommitted work, so your edits are untouched.
What to do. Commit the changes or discard them, then try again.

### pull_failed
What it means. The launcher could not bring your copy of the player up to date. The message gives the step that failed.
Why it is safe. The launcher stops before the session starts, so nothing was started or changed on GitHub.
What to do. Check your network and the remote, then try again. Do not force the branch, because the launcher never merges.

### unfinished
What it means. The last session for this player did not finish.
Why it is safe. The launcher keeps the leftover state and does not start a new session over it.
What to do. Run the resolve command the message prints.

### workspace_exists
What it means. A workspace from an earlier session was left behind.
Why it is safe. The launcher does not reuse or delete an unfinished workspace on its own, so nothing was started.
What to do. Run resolve first to see whether a session is held. Then run the resolve command with --discard the message prints, because --discard drops any held session.

### workspace_failed
What it means. The launcher could not prepare the workspace. The message names the step: the kit export, the start bundle, the volume, the staging, a timeout, or the CLI volume.
Why it is safe. The launcher stops before the container starts, so nothing ran and nothing was saved.
What to do. Check that Docker is running and that the disk has room, then try again. If it keeps failing, report the step the message names.

### bad_player_json
What it means. The player.json file for this player is not valid. The message gives the detail.
Why it is safe. The launcher stops before it uses any value from the file.
What to do. Correct the file to the format the README describes, or create the player again.

### harness_unsupported
What it means. The player asks for a program this version cannot run.
Why it is safe. The launcher refuses before it starts a container. Only Claude Code runs in this version.
What to do. Set the player to use Claude Code.

### host_path_in_workspace
What it means. The workspace was not isolated from the host, because a host path appeared in it.
Why it is safe. The launcher stopped before the session, so nothing was started in that workspace.
What to do. Do not work around it. Report it to the project with the message text.

### branch_changed
What it means. Your copy of the player is not on its usual branch.
Why it is safe. The launcher will not save to a branch it did not expect.
What to do. Switch back to the usual branch, then try again.

### bad_export_name
What it means. A kit file name cannot be mounted safely.
Why it is safe. The launcher refused before it started, so nothing was mounted.
What to do. Report the file name to the kit maintainers.

### compose_failed
What it means. The container did not start.
Why it is safe. Nothing was saved. The launcher does not retry for you.
What to do. Check that Docker is running, then start the session again.

### run_setting_bad
What it means. A setting for the headless run is not valid. The message names the variable: GELDAR_RUN_PROMPT_FILE, GELDAR_RUN_MAX_TURNS or GELDAR_RUN_MODEL.
Why it is safe. The launcher refused before it started, so nothing was mounted and nothing ran.
What to do. Set that variable again: a full path to the prompt file, a whole number of turns, or a plain model name.

### run_start
What it means. The supervisor started for the player and will keep playing full cycles until it is stopped. A STOP file made by run-stop is cleared at the start; one the supervisor wrote itself (see run_stopped_auto) is not.
Why it is safe. Every cycle is a normal play cycle: the same checks, the same container, the same save step. Nothing is skipped.
What to do. Nothing. Run run-status to see how it is going, or run-stop to end it.

### run_stop_requested
What it means. A STOP file (first line manual) was written in the player's run folder. Nothing says a supervisor is running.
Why it is safe. A running cycle is never cut short. A running supervisor finishes the round, saves it, then stops. With none running the file is cleared at the next start.
What to do. Wait for the supervisor to print that it stopped.

### run_cap_reached
What it means. Today's cost (UTC) reached the daily cap, so the supervisor waits for the next day.
Why it is safe. Nothing runs while it waits. It resumes by itself and can still be stopped.
What to do. Nothing, or raise the cap with GELDAR_RUN_DAILY_CAP_USD and start again.

### run_backoff
What it means. The last cycle failed or ended too quickly, so the supervisor waits longer before the next one. The wait doubles each time, up to a limit.
Why it is safe. Waiting costs nothing, and a good cycle resets the wait.
What to do. Nothing. If it keeps happening, look at run/supervisor.log in the player's state folder.

### run_too_many_failures
What it means. Too many cycles in a row failed, so the supervisor wrote a STOP file (first line auto) and stopped. It will not start again until that file is deleted.
Why it is safe. Nothing more is run, and nothing was lost: each cycle still went through the normal save step.
What to do. Find the cause in run/supervisor.log, fix it, delete the STOP file in the run folder and start again.

### run_already_running
What it means. Another supervisor holds the lock for this player. The message names the lock folder and the process number.
Why it is safe. Two supervisors would run the same player twice, so the second one refused before doing anything.
What to do. Use run-stop to end the first one, or wait for it to finish. If that process is not a supervisor, delete the lock folder named in the message and start again.

### run_status_none
What it means. The player has no run folder, so no supervisor has ever run for it.
Why it is safe. Nothing was changed.
What to do. Start one with run, then ask again.

### run_held
What it means. A cycle ended with the saved session held back (a failed check, or a hold left from before). The supervisor wrote a STOP file (first line auto) and stopped at once.
Why it is safe. Retrying cannot fix a held session, so nothing more is run, and the held bundle and workspace are kept.
What to do. Run geldar-play resolve for the player, then start the run again. Delete the STOP file in the run folder if it is still there.

### run_stopped_auto
What it means. The last run stopped itself (too many failed cycles, or a held session) and left a STOP file whose first line says why.
Why it is safe. The supervisor refused before doing anything.
What to do. Look at the file named in the message and at run/supervisor.log, fix the cause, delete that file and start again.

### run_stopping
What it means. A stop signal arrived (Ctrl-C, a closed terminal or a kill). The supervisor ends after the current round.
Why it is safe. A running cycle is never cut short: its save step finishes and its cost is recorded.
What to do. Wait for the stopped message.

### run_stopped
What it means. The supervisor ended.
Why it is safe. It only ends between cycles, never in the middle of one.
What to do. Nothing. Start it again with run when you want the player to live on.

### bundle_too_large
What it means. The session saved far too much to be packed, so it is kept.
Why it is safe. The launcher did not send the session anywhere, and it stays held for you to look at.
What to do. Run resolve for the player and look at what the session changed.

### bundle_failed
What it means. The session could not be packed up.
Why it is safe. The session is kept, not discarded, and nothing was pushed.
What to do. Run resolve for the player.

### verify_unreadable
What it means. The check of the session gave no clear answer.
Why it is safe. The launcher treats an unclear check as a failed one, so nothing was saved and the session is kept.
What to do. Run resolve for the player.

### verify_rejected
What it means. The check refused the session. The reason lines printed with it say why.
Why it is safe. A rejected session is not saved, and it is kept as held state.
What to do. Read the reason, then run resolve for the player. Do not copy the changes into GitHub by hand.

### recheck_failed
What it means. The second check of the session failed. The message gives the reason.
Why it is safe. The launcher checks again before it saves, so a session that fails the check is not saved.
What to do. Run resolve for the player.

### reason_bad_arguments
What it means. The check could not be started, so nothing was saved.
Why it is safe. The session is kept, and nothing was pushed.
What to do. Run resolve for the player. If this keeps happening, report it to the project.

### reason_verify_error
What it means. The check of the session failed to finish, so nothing was saved.
Why it is safe. The session is kept, and nothing was pushed.
What to do. Run resolve for the player. If this keeps happening, report it to the project.

### reason_bundle_too_large
What it means. The session saved far too much.
Why it is safe. The launcher refused it, and the session is kept.
What to do. Run resolve for the player and look at what the session changed.

### reason_bundle_unreadable
What it means. The session could not be read.
Why it is safe. The launcher did not save anything from an unreadable session, and it is kept.
What to do. Run resolve for the player.

### reason_bundle_refs_unexpected
What it means. The session changed more than its own branch.
Why it is safe. Only the player's own branch may change, so the launcher refused the session.
What to do. Run resolve for the player and remove the extra changes.

### reason_bundle_fetch_failed
What it means. The session could not be brought in safely.
Why it is safe. The launcher did not accept the session, and it is kept.
What to do. Run resolve for the player.

### reason_too_many_commits
What it means. The session made far too many saves.
Why it is safe. The launcher refused it, and it is kept for you to look at.
What to do. Run resolve for the player and check the session's work.

### reason_not_fast_forward
What it means. The session rewrote saves that were made before.
Why it is safe. Earlier saves are never rewritten, so the launcher refused the session.
What to do. Run resolve for the player. Do not force a push.

### reason_merge_commit
What it means. The session joined two lines of saves together, which is not allowed.
Why it is safe. The launcher never merges, so it refused the session.
What to do. Run resolve for the player and keep the saves in one line.

### reason_identity_mismatch
What it means. The session saved under a name that is not the player.
Why it is safe. Saves must come from the player, so the launcher refused the session.
What to do. Run resolve for the player and check who made the saves.

### reason_identity_changed
What it means. The session changed who the player is.
Why it is safe. The identity is written once, so the launcher refused the change.
What to do. Run resolve for the player. Report it to the project if the change was not yours.

### reason_path_not_allowed
What it means. The session changed a file that a player may not change.
Why it is safe. The launcher refused the session, so that file is unchanged.
What to do. Run resolve for the player and remove the change to that file.

### reason_symlink_not_allowed
What it means. The session added a link where a file belongs.
Why it is safe. The launcher refused the link, so nothing was saved.
What to do. Run resolve for the player and replace the link with the real file.

### reason_gitlink_not_allowed
What it means. The session added a folder that is really another repository.
Why it is safe. The launcher refused it, so nothing was saved.
What to do. Run resolve for the player and remove that folder from the session.

### reason_executable_not_allowed
What it means. The session made a file runnable.
Why it is safe. The launcher refused the file mode, so nothing was saved.
What to do. Run resolve for the player and clear the executable bit.

### reason_bad_mode
What it means. The session saved a file in a form that is not allowed.
Why it is safe. The launcher refused the file, so nothing was saved.
What to do. Run resolve for the player and save the file in its plain form.

### recheck_case_collision
What it means. A name in the session differs from a name you already have only by upper and lower case. The message names the pair.
Why it is safe. Names like these can overwrite each other on some systems, so the launcher refused the session.
What to do. Run resolve for the player and rename one of the two files.

### fetch_failed
What it means. The session could not be brought in from GitHub safely.
Why it is safe. Nothing was saved, and the session is kept.
What to do. Check the network, then run resolve for the player.

### push_failed
What it means. The launcher could not send the memory to GitHub.
Why it is safe. Nothing is lost. The session is kept and held.
What to do. Check the network and your GitHub access, then run resolve for the player.

### host_moved
What it means. Your copy of the player changed during the session.
Why it is safe. The launcher would not save over a copy that moved, so nothing was saved and the session is kept.
What to do. Look at what changed in your copy, then run resolve for the player.

### ff_failed
What it means. The memory reached GitHub, but your copy could not be brought up to date.
Why it is safe. The saved commits are on GitHub, and the launcher did not rewrite your copy.
What to do. Run resolve for the player to bring your copy up to date.

### no_world
What it means. No world address is set in `launcher/config/world.conf`. The shipped file sets it, so this means the value was blanked.
Why it is safe. The launcher refused before it created anything.
What to do. The owner sets the world address in `launcher/config/world.conf`. A player cannot set it.

### private_list_unset
What it means. The list of private-only shards is not set, so the launcher cannot check whether this shard needs a private repository.
Why it is safe. The launcher says so instead of guessing which shards need a private repository.
What to do. Ask the owner to set `private_only_shards`, or pass --private yourself.

### private_required
What it means. The shard needs a private repository, so the message asks for --private.
Why it is safe. The launcher refused to create a public repository for it, so nothing was created.
What to do. Run new again with --private. A public repository needs an explicit --public.

### repo_exists
What it means. A player with that name already exists on this machine.
Why it is safe. Nothing was created, and the existing player is untouched.
What to do. Choose another name, or use the existing player.

### gh_failed
What it means. GitHub did not finish a step of making the repository. The message names the step: create, template, add, commit or push.
Why it is safe. Nothing was kept on this machine: the launcher removed its local folder for the attempt.
What to do. Check that gh is signed in and has access. If the step was add, commit or push, the repository was already made on GitHub, so read the message after this one before you try again.

### clone_timeout
What it means. GitHub did not finish making the repository in time.
Why it is safe. The launcher stopped waiting after five checks and removed its local folder, so no half-made clone is left here.
What to do. Check the repository on GitHub. If it is there, follow repo_on_github before you run new again.

### repo_on_github
What it means. The repository player-<id> was made on GitHub, but a later step failed, so the local folder was removed.
Why it is safe. The launcher did not write the player's state, so no half-made player is left on this machine.
What to do. Delete the repository player-<id> on GitHub, then run new for the same id again. While the repository is still there, the next new stops at the create step.

### repo_bad
What it means. The value given to --repo is not owner/name. The owner has letters, digits and dashes (up to 39); the name has letters, digits and . _ - (up to 100); the name is not . or .., and --repo is given once.
Why it is safe. The launcher refused the option before it called GitHub, so nothing was created.
What to do. Give the value as owner/name, for example SandboxServers/player-mmpr-pink.

### repo_missing
What it means. The repository given to --repo was not found, or gh cannot see it. The message names it.
Why it is safe. The launcher stopped before it cloned or changed anything.
What to do. Check the spelling and that gh is signed in with access to that repository, then run new again.

### repo_visibility
What it means. The repository given to --repo has a different visibility from the one asked for. The message names the repository, its visibility and the requested one.
Why it is safe. The launcher stopped before it cloned or changed anything.
What to do. Pass --public or --private to match the repository, or change the repository's visibility on GitHub first.

### repo_not_empty
What it means. The repository given to --repo must hold at least one of README.md, LICENSE and .gitignore, and nothing else, at the top level. It holds other files, or a link in place of one of those names, or it has no commit yet, or gh could not list its files.
Why it is safe. The launcher fills only a repository it has verified as nearly empty. It stopped before it changed anything on GitHub (a local clone it made is removed), and it never force-pushes.
What to do. Give the repository its first commit with one initial README (GitHub offers this when you create it), or remove the extra files on GitHub, then run new again.

### adopt_failed
What it means. A step failed after new cloned the repository given to --repo (the message names it: clone, template, add, commit or push). The repository may already hold the first commit for the player, for example when a push was cut off by the time limit.
Why it is safe. The launcher removed its local folder and wrote no state, and it never force-pushes. It does not delete a repository that was there before.
What to do. Look at the repository on GitHub. If it holds the player's files, clear it (delete the files and commit, or recreate the repository with its initial README), then run new again. If it holds only the README, run new again.

### template_unpinned
What it means. The template repository has no released kit version (a tag kit-v followed by a version), so new --repo has nothing fixed to copy from.
Why it is safe. The launcher stopped before it cloned or changed anything.
What to do. Ask the owner to release the template, or try again later.

### template_too_big
What it means. The template holds more than 2000 files or more than 20 MB, so new --repo refused to copy it.
Why it is safe. The launcher removed its local clone and changed nothing on GitHub.
What to do. Tell the owner: the template release is not the size the launcher expects.

### bad_shard
What it means. The shard name is not allowed.
Why it is safe. The launcher checked the name before it created anything.
What to do. Use lowercase letters, digits and dashes.

### bad_url
What it means. The world address is not allowed. It must use http or https and a host name only.
Why it is safe. The launcher refused the address before it created anything.
What to do. The owner corrects the address in `launcher/config/world.conf`. A port is allowed only when it is the `mcp_port`.

### bad_token
What it means. The token file is not valid. It needs one line of 16 to 200 letters, digits, or `. _ ~ -`. The line may start with `GELDAR_MCP_TOKEN=` (the form Geldar writes); any other prefix is refused.
Why it is safe. The launcher refused the file before it created anything.
What to do. Replace the file with a token in that form. Never paste a token into a chat or a commit.

### setup_empty
What it means. setup finished without writing who the player is.
Why it is safe. The launcher reports the identity as still empty, so the player is not treated as set up.
What to do. Run setup for the player again, and write who the player is when it asks.

### resolve_diverged
What it means. origin has moved on since the session was held. The held session cannot be added without a merge, and the launcher never merges. The exit code is 3.
Why it is safe. The launcher did not merge or change GitHub, and the held session is still held.
What to do. Keep the held work by merging it yourself outside the launcher. resolve --discard drops the whole held session.

### resolve_host_changed
What it means. Your copy changed since the session was held, so the held session cannot be added. The exit code is 3.
Why it is safe. The launcher did not overwrite your copy, and the held session remains.
What to do. Look at your copy. Use resolve --discard only if you are willing to lose the held session.

### resolve_nothing
What it means. Nothing is held for this player.
Why it is safe. There was nothing to resolve, so nothing changed.
What to do. Nothing. Start play as usual.

### discarded
What it means. The held session was dropped with resolve --discard. The message gives the number of commits lost.
Why it is safe. The launcher drops only what you asked it to drop, and it reports the count.
What to do. The commits were never pushed and cannot be recovered by the launcher. Check the count is what you expected.

### not_pushed
What it means. Your copy is not the same as GitHub's. It has unsaved changes, or changes that are not pushed.
Why it is safe. The launcher refused to archive, so GitHub and your copy are untouched.
What to do. Save and push your changes, then run archive again.

### archive_confirm
What it means. The launcher asks you to type the confirmation text, which is archive followed by the player id.
Why it is safe. Archiving stops play and removes the player from this machine, so the launcher needs the exact words. Nothing was archived.
What to do. Type the exact text to confirm, or stop.

### archive_target
What it means. The origin of the player is not a player repository on GitHub.
Why it is safe. The launcher does not archive a repository it does not recognise, so nothing was archived.
What to do. Check the origin of the player's copy. It must point at the player's repository.

### archive_held
What it means. The player has a held or unfinished session.
Why it is safe. Archiving would lose that session, so the launcher refused.
What to do. Run resolve for the player, then archive again.

### dup_player
What it means. The same player id is listed twice.
Why it is safe. The launcher refused before any session started.
What to do. List each player once.

### persona_missing
What it means. The persona directory does not hold memory/identity.md and memory/goals.md for the player. The message names the directory.
Why it is safe. Nothing was created.
What to do. Give a directory that holds both files, then run the command again.

### persona_bad
What it means. The persona files were refused. The reason is in brackets: size means over the byte cap (8192 bytes for identity.md, 4096 for goals.md); control means a control character; utf8 means not valid UTF-8; invisible means an invisible code point; link means a symbolic link; hardlink means a file with more than one hard link; type means not a plain file or folder; empty means an empty file; twice means the option was given twice.
Why it is safe. The files are checked before anything is written, so nothing was created.
What to do. Fix the named problem in the persona files, then run the command again.

### dev_world_bad
What it means. GELDAR_DEV_MCP_URL is set, but it is not exactly `http://host.docker.internal:PORT/p/ID` with PORT from 1024 to 65535 and no leading zero.
Why it is safe. The launcher refused before any lock, state or Docker call, so nothing ran.
What to do. Correct the value to that shape, or unset it. The testing section explains the rest.

### dev_world_single
What it means. GELDAR_DEV_MCP_URL names one player's world, and you started more than one player.
Why it is safe. The launcher refused before any session started.
What to do. Start one player at a time while the variable is set.

### upgrade_downgrade
What it means. The kit release is older than the kit in the player. The message gives both versions.
Why it is safe. The launcher does not move a player to an older kit, so nothing was changed.
What to do. Wait for a newer release.

### upgrade_no_release
What it means. No kit release was found in the template repository.
Why it is safe. The launcher had nothing to use, so nothing was changed.
What to do. Try again later. The release may not be published yet.

### upgrade_bad_release
What it means. The kit release did not pass the checks.
Why it is safe. The launcher did not use it, so nothing in the player changed.
What to do. Wait for a corrected release. Do not copy kit files in by hand.

### upgrade_branch_exists
What it means. The upgrade branch already exists in the player's repository.
Why it is safe. The launcher did not overwrite it.
What to do. Look at that branch. Remove it by hand only if you do not need it, then run the upgrade again.

### upgrade_held
What it means. A held session is waiting for this player, so the upgrade cannot start.
Why it is safe. The launcher refused, and the held session is kept.
What to do. Run resolve for the player, then run the upgrade again.

### upgrade_pr_failed
What it means. The upgrade branch was pushed, but the pull request could not be made.
Why it is safe. Memory was not touched, and the branch is on GitHub for you to review.
What to do. Open the pull request by hand from that branch.

### upgrade_dirty
What it means. The player's copy has unsaved changes, or could not be brought up to date.
Why it is safe. The launcher stopped before it changed any branch.
What to do. Commit or discard the changes, make sure the copy is up to date, then run the upgrade again.

### upgrade_verify
What it means. The launcher prints a cosign command that checks the signature of the kit image.
Why it is safe. The launcher does not merge anything. The command lets you check the image first.
What to do. Run the command, which needs cosign installed. Merge the pull request only if the check passes.

### auth_set_prompt
What it means. The launcher is asking you to paste the shared login token. Nothing you type is shown on screen.
Why it is safe. The token is read without echo, is never written to the screen or to a log, and is stored in one file that only your account can read.
What to do. If you have no token yet, run `claude setup-token` once, copy what it prints, and paste it here. You can also pipe it in or give a file with `--token-file`, but the hidden prompt is safer: a piped token or a token file can stay in shell history or on disk, so delete the token file after use and avoid `bash -x`.

### auth_set_done
What it means. The shared login token is stored in one private file on this machine. Every player started from now on uses it, so no player needs to sign in again.
Why it is safe. The file is readable by your account only. The token reaches a player's container only as an environment variable of the compose process, never on a command line.
What to do. Nothing. Run `auth-status` to check it, or `auth-clear` to remove it.

### auth_status_set
What it means. A shared login token is stored and its file and folder are owner only. Players use it instead of a login of their own.
Why it is safe. The command never shows the token or any part of it.
What to do. Nothing. Run `auth-clear` if you want players to sign in on their own again.

### auth_status_not_set
What it means. No shared login token is stored (or the stored file is not valid). Each player signs in on their own, as before.
Why it is safe. Nothing is shared, so nothing is at risk.
What to do. Run `claude setup-token` once, then `auth-set`, if you want one login for every player on this machine.

### auth_status_open_mode
What it means. A shared login token is stored, but its file or folder can be read by other accounts on this machine.
Why it is safe. The command did not change anything and did not show the token.
What to do. Run `auth-set` again with the token: it writes a fresh owner-only file. If other accounts could have read the old file, replace the token as well by running `claude setup-token` again.

### auth_status_invalid
What it means. A shared login file is present but it is not a valid token (two lines, a trailing space, a byte order mark, a NUL byte, or over 400 characters), so it is not used.
Why it is safe. The command did not change anything and did not show the file's content.
What to do. Run `claude setup-token`, then `geldar-play auth-set`. Or run `auth-clear` so each player signs in on their own.

### auth_stored_invalid
What it means. A session start found a shared login file that is not valid, or whose file or folder can be read by others. It was not passed to the player, which then asks for a login of its own.
Why it is safe. Nothing is sent to the container from a file that is not valid or not private.
What to do. Run `claude setup-token`, then `geldar-play auth-set`. If a session fails to sign in with a stored token, the token may be revoked or expired: run `claude setup-token` again, then `geldar-play auth-set`. Run `auth-clear` to fall back to a login for each player.
### auth_cleared
What it means. The stored shared login token file was removed (or there was none).
Why it is safe. Players that already signed in on their own keep their own login. A removed file does not revoke the token itself.
What to do. To revoke the token itself, run `claude setup-token` again or use the account's settings. Run `auth-set` to store a new one.

### auth_bad_token
What it means. What was given is not a usable token. It must be exactly one line of 20 to 400 letters, digits and the characters `.`, `_`, `~` and `-`. Spaces, an equals sign or a second line are refused.
Why it is safe. Nothing was stored and the old token, if any, is unchanged. The refused text is not shown.
What to do. Run `claude setup-token`, copy only the token it prints, and run `auth-set` again.
