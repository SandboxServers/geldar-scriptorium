# ChatGPT harness live acceptance

Worknote template for HC-02. A person verifies each item on the player already running on the ChatGPT harness (`ag-picard-01`) and fills the "Observed" and "Date (UTC)" lines. The coder does not fill them. After sign-off, the session amends `docs/chatgpt.md` (HC-16).

Mask any token shown in pasted output. Read state through `geldar-play player-status` and `geldar-play logs`, never by opening a model transcript.

## Setup

- [ ] Kit image digest and launcher version in use are recorded.
  - Observed:
  - Date (UTC):
- [ ] Declared model is recorded.
  - Observed:
  - Date (UTC):
- [ ] Output of `geldar-play player-status ag-picard-01` is pasted, with the token masked.
  - Observed:
  - Date (UTC):

## 1 Completed waking

- [ ] The supervisor `status.json` shows `last_result: ok` and state `sleeping` or `running`.
  - Observed:
  - Date (UTC):
- [ ] `geldar-play logs ag-picard-01` shows at least one `run=N turns=T ... result=ok` line with T above 0.
  - Observed:
  - Date (UTC):
- [ ] The last `session-N.jsonl` has a `result` line with `is_error` false, seen through `player-status`.
  - Observed:
  - Date (UTC):

## 2 Saved memory

- [ ] The keeper status shows `last_pushed_head` changed after a run.
  - Observed:
  - Date (UTC):
- [ ] The player's repo has a new commit touching only `memory/` or `skills/`.
  - Observed:
  - Date (UTC):
- [ ] No `HELD` file is present.
  - Observed:
  - Date (UTC):

## 3 Clean restart

- [ ] `geldar-play restart ag-picard-01` is run.
  - Observed:
  - Date (UTC):
- [ ] `player-status` returns to running with no `chatgpt_no_login` message.
  - Observed:
  - Date (UTC):
- [ ] The next waking after the restart ends `result=ok`.
  - Observed:
  - Date (UTC):
- [ ] `last_pushed_head` still advances.
  - Observed:
  - Date (UTC):

## 4 Usage-limit behaviour

- [ ] What the kit does today is documented: a refused request is a failed cycle, so five in a row write an `auto:` STOP after the backoff.
  - Observed:
  - Date (UTC):
- [ ] Whether a limit was hit since the start is recorded, from the gaps in `supervisor.log` and ChatGPT Settings, Usage.
  - Observed:
  - Date (UTC):
- [ ] If an `auto:` STOP happened, its first line is recorded.
  - Observed:
  - Date (UTC):
- [ ] Whether the behaviour is acceptable, or a card is needed to map the limit to the `limited` state as the Claude harness does, is stated.
  - Observed:
  - Date (UTC):

## 5 Metering gap

- [ ] `costs.csv` cost is 0 for this harness, and no token count exists until HC-03. This is noted.
  - Observed:
  - Date (UTC):
- [ ] Turns per waking are recorded from `costs.csv`.
  - Observed:
  - Date (UTC):

## Verdict

- [ ] Verdict is one of: accepted, accepted with notes, or failed.
  - Observed:
  - Date (UTC):
- [ ] Who signed off is recorded.
  - Observed:
  - Date (UTC):
- [ ] Date of sign-off is recorded.
  - Observed:
  - Date (UTC):
