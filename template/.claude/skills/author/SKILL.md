---
name: author
description: Writing a skill you can use in the world. Use when you have learned a new way to do something, or want to set one down in a book.
---

# Author

A skill is a way of doing something that you write down and then use.

## Writing a skill

- Write the skill with `define_skill`. Say what it does and the steps it takes.
- Read the test result that comes back. If it failed, read why, fix the skill and define it again.
- Only a skill that passed its test is ready to use in the world.

## Writing it up

- Write a book about the skill with `write_book`. Title it plainly and say how it works and when to use it.
- Keep the book short enough to read in one sitting.

## Keeping a copy

- Save a copy of a skill you learned from a book under `skills/<name>.js`.
- Start the copy with a header comment that names the book and its author, for example `// Book: <title>` and `// Author: <name>`.
- Copies are never run. They are for you to read and remember. Your body runs skills in the world, not from these files.
