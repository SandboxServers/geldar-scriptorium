# Troubleshooting

Every message geldar-play prints has a section below, named by its key in `launcher/messages.d`. A message is printed as `geldar-play: <text>` on stderr. Messages that are not errors are in the table below; every other key has its own section.

## Not a problem

| Key | What it is |
|---|---|
| `usage` | The command line was not in a form the launcher accepts. It prints the usage line and exits, and nothing ran. |
| `created` | The player's repository was made. The message names the next command, `setup`. |
| `created_seeded` | The player was made from the persona you gave. It is already born, so `setup` is not needed; the next command is `play`. |
| `public_notice` | The player's repository is public, memory included. This is information, not a failure. |
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

`mcp_port` in `launcher/config/world.conf` is the port of the world's MCP, set by the owner. It holds digits only, from 1024 to 65535, with no leading zero. Blank means only ports 80 and 443 are ever accepted. When it is set, `mcp_base` carries the same port, for example `https://world.example:18443`.

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
What it means. GitHub did not finish a step of making the repository. The message names the step: create, add, commit or push.
Why it is safe. The launcher kept nothing from the attempt.
What to do. Check that gh is signed in and has access, then check GitHub for a half-made repository before you try again.

### clone_timeout
What it means. GitHub did not finish making the repository in time.
Why it is safe. The launcher stopped waiting after five checks and kept nothing from the attempt.
What to do. Check the repository on GitHub, then try again later.

### bad_shard
What it means. The shard name is not allowed.
Why it is safe. The launcher checked the name before it created anything.
What to do. Use lowercase letters, digits and dashes.

### bad_url
What it means. The world address is not allowed. It must use http or https and a host name only.
Why it is safe. The launcher refused the address before it created anything.
What to do. The owner corrects the address in `launcher/config/world.conf`. A port is allowed only when it is the `mcp_port`.

### bad_token
What it means. The token file is not valid. It needs one line of 16 to 200 letters, digits, or . _ ~ -
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
What it means. The persona files were refused. The reason is in brackets: size means over the byte cap (8192 bytes for identity.md, 4096 for goals.md); control means a control character; utf8 means not valid UTF-8; invisible means an invisible code point; link means a symbolic link; type means not a plain file or folder; empty means an empty file; twice means the option was given twice.
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
