# The character sheet, held privately on this machine (HC-26a). Sourced; bash 3.2 syntax only.
# Nothing here prints or logs the sheet text: a refusal names only its reason.

# The largest sheet the launcher stores, in bytes.
SHEET_MAX=4096

# sheet_check file id: dies with sheet_bad unless the file is a plain file of 1 to SHEET_MAX bytes,
# valid UTF-8 text whose first non-blank character is {. Links are refused before anything is read.
sheet_check() {
  local f=$1 id=$2 size
  [ ! -L "$f" ] || die 1 sheet_bad "$id" link
  [ -f "$f" ] || die 1 sheet_bad "$id" type
  size=$(wc -c < "$f" 2> /dev/null | tr -d ' ') || size=0
  [ -n "$size" ] || size=0
  if [ "$size" -lt 1 ] || [ "$size" -gt "$SHEET_MAX" ]; then
    die 1 sheet_bad "$id" size
  fi
  perl -0777 -ne 'use Encode (); my $t = $_; exit 1 unless eval { Encode::decode("UTF-8", $t, Encode::FB_CROAK | Encode::LEAVE_SRC); 1 }; exit($t =~ /\A[ \t\r\n]*\{/ ? 0 : 1);' "$f" ||
    die 1 sheet_bad "$id" text
}

# sheet_store id file: checks the file, then copies it to sheet.json in the player's state
# directory. The copy is written through a temporary file (mode 0600) and renamed into place.
sheet_store() {
  local id=$1 f=$2 d tmp
  sheet_check "$f" "$id"
  d=$(player_dir "$id")
  private_mkdir "$d"
  tmp=$(mktemp "$d/sheet.XXXXXX") || die 1 sheet_bad "$id" write
  if ! cat -- "$f" > "$tmp" || ! chmod 600 "$tmp" || ! mv -f "$tmp" "$d/sheet.json"; then
    rm -f "$tmp"
    die 1 sheet_bad "$id" write
  fi
  say sheet_stored "$id"
}

# The script the delivery helper runs (HC-26b). It checks the staged files before it copies either one:
# exit 2 a refused sheet, 3 a refused roster (not a regular file, or over 16 KiB), 1 or 4 a failed copy.
# It holds no double quote: the pwsh twin passes it through a cmd shim as one argument.
SHEET_DELIVER='umask 077; mkdir -p /vol/instinct && chown 1001:1001 /vol/instinct || exit 1; if [ -e /in/sheet.json ]; then geldar-instinct check-sheet /in/sheet.json || exit 2; fi; if [ -e /in/roster.json ]; then [ -f /in/roster.json ] && [ $(wc -c < /in/roster.json) -le 16384 ] || exit 3; fi; if [ -e /in/sheet.json ]; then cp /in/sheet.json /vol/instinct/.sheet.tmp && chown 1001:1001 /vol/instinct/.sheet.tmp && chmod 0600 /vol/instinct/.sheet.tmp && mv -f /vol/instinct/.sheet.tmp /vol/instinct/sheet.json || exit 1; fi; if [ -e /in/roster.json ]; then cp /in/roster.json /vol/instinct/.roster.tmp && chown 1001:1001 /vol/instinct/.roster.tmp && chmod 0600 /vol/instinct/.roster.tmp && mv -f /vol/instinct/.roster.tmp /vol/instinct/roster.json || exit 4; fi'

# verb_sheet_set id file: replaces the stored sheet of a player that already exists, then delivers it
# (and the roster, when one is stored) to the supervisor volume.
verb_sheet_set() {
  [ $# -eq 2 ] || die 2 usage
  read_player "$1"
  lock_acquire "$1"
  sheet_store "$1" "$2"
  pl_deliver_sheet "$1"
}
