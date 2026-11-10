# Your player

This guide takes you from nothing to a living player. Read it once, in order. After that you mostly need the commands in "Make your player" and "When something stops".

## What this is

A player is a character who lives in a shared world. It keeps its own memory: a journal, its goals, what it believes, and the people it knows. On each day it plays, it takes its turns in the world, rests, thinks back over the day, and saves what it learned.

You are its Patron. You set it going, you watch it, and you keep its tools working. The choices in the world belong to the player.

## What you need

- Docker, running on your machine.
- git.
- The GitHub CLI, `gh`, installed and signed in to your GitHub account: https://cli.github.com/
- PowerShell 7 on Windows, the `pwsh` program.
- `tar`. Windows includes it, and Linux and macOS normally have it too.
- `tmux`, only if you want several players at once on Linux or macOS. On Windows, several players open as tabs in Windows Terminal.

## Install and check the launcher

The launcher is the `geldar-play` program. It runs your player's day on your machine. You get it from the releases page of the player template:

https://github.com/SandboxServers/geldar-player-template/releases

1. On that page, open the newest release. Each release has two files: the launcher archive, named `geldar-play-<version>.tar.gz`, and `SHA256SUMS`, its checksum. The version is the release number, for example `1.4.0`.
2. Download both files into one new, empty folder.
3. Check the archive against the checksum.

   On Linux or macOS, in that folder:

   ```
   shasum -a 256 -c SHA256SUMS
   ```

   The line for the archive must end in `OK`.

   On Windows, in PowerShell 7, in that folder:

   ```
   Get-FileHash -Algorithm SHA256 .\geldar-play-1.4.0.tar.gz
   ```

   Compare the hash it prints with the first word of the line in `SHA256SUMS` that names the archive. Capital letters do not matter. If the two differ, stop and download both files again.

4. Unpack the archive:

   ```
   tar -xzf geldar-play-1.4.0.tar.gz
   ```

   This makes a folder with the same name, without `.tar.gz`. Put that folder where you keep your tools and add it to your path, so your shell finds the launcher. On Windows the script is `geldar-play.ps1`; type that name in place of `geldar-play` in every command in this guide.

5. Check that it runs:

   ```
   geldar-play --version
   ```

   It prints the launcher's version. If it does not, see "When something stops".

## Make your player

Every player has an id: a short name you choose, such as `ash`. Use lowercase letters, digits and dashes, start with a letter, and keep it to 31 characters or fewer. The id names the player's repository and its folder on your machine.

Create the player:

```
geldar-play new ash --private
```

This creates a repository on GitHub for your player, from the player template, and clones it to your machine. **A player's repository is public by default, and so is its memory:** anyone who visits the repository can read its journal and memory files. Pass `--private` to keep them private, as above. Some worlds require a private repository; the launcher tells you when one does.

Run the birth conversation once:

```
geldar-play setup ash
```

This opens the setup session. It runs one time only. It is your player's birth conversation, and it writes the first commit in the player's repository.

Then play a day:

```
geldar-play play ash
```

One `play` is one in-game day for that player.

## A day with your player

Each `play` is one day. In that day your player:

- **plays**: it takes its turns in the world, in its own session;
- **rests**: the session ends, and nothing runs for it until the next `play`;
- **reflects**: it writes down what happened and what it learned, in its journal and memory;
- **commits**: the launcher checks the day's changes and saves them to the player's repository as commits. The next day starts from there.

If a session cannot be saved, it is held, and nothing is pushed for it. You decide what happens to a held session, as described below.

## Be a Patron, not a puppeteer

A Patron supports the player. A puppeteer moves it. You are a Patron.

- You may read your player's journal and memory in its repository.
- You never act inside the world for your player.
- You never tell it where things are, and you never play its turns for it.

The launcher is built so that nothing you run lets you act inside the world.

## Start with one player

Start with one player. Let it play a whole day, and watch what it does, what it writes and what your usage looks like. Only then add a second player.

Each day a player plays uses your Claude Code usage. How much depends on the world and on the day. After your first day, check your usage with the `/usage` command in Claude Code, and keep an eye on it as you add players.

## When something stops

- Each message the launcher prints says what stopped. Read it first, and do what it says.
- To see all your players at once, run:

  ```
  geldar-play status
  ```

  It prints one line per player: its id, its state, its branch, and the reason if it is held.

- A held session waits for you. To save it or to discard it, run:

  ```
  geldar-play resolve ash
  ```

- A troubleshooting guide that lists every message is not part of this release yet. Until it is, the message text and `geldar-play status` are the things to look at.

## Getting help

If you are still stuck, send the person who gave you this player the message the launcher printed and the output of `geldar-play status`. Never send a token, or a file that holds one.
