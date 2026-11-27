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

# verb_sheet_set id file: replaces the stored sheet of a player that already exists.
verb_sheet_set() {
  [ $# -eq 2 ] || die 2 usage
  read_player "$1"
  lock_acquire "$1"
  sheet_store "$1" "$2"
}
