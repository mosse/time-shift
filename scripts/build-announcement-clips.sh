#!/bin/bash
# Renders the gap announcement clips (macOS only: uses `say` and `afconvert`).
# Output is HE-AAC ADTS, the same codec as the BBC stream, so src/services/gap-audio.js
# can splice the frames straight into filler segments. Run once; commit the output.
set -euo pipefail

out="$(cd "$(dirname "$0")/.." && pwd)/src/assets/announcements"
voice="${VOICE:-Matilda (Premium)}" # Premium voices: System Settings > Accessibility > Spoken Content
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"

clip() {
  say -v "$voice" -o "$tmp/$1.aiff" "$2"
  afconvert -f WAVE -d LEI16@48000 -c 2 "$tmp/$1.aiff" "$tmp/$1.wav"
  afconvert -f adts -d aach -b 80000 "$tmp/$1.wav" "$out/$1.aac"
}

clip returns "This is Encore Dot FM. Part of this broadcast wasn't recorded. Normal programming returns by"
clip interrupted "This is Encore Dot FM. Recording has been interrupted. Normal programming will return once it resumes."
clip silence "[[slnc 1000]]"

hours=(one two three four five six seven eight nine ten eleven twelve)
for h in "${!hours[@]}"; do clip "h$((h + 1))" "${hours[$h]}"; done

minutes=("o'clock" "oh five" ten fifteen twenty "twenty five" thirty "thirty five" forty "forty five" fifty "fifty five")
for m in "${!minutes[@]}"; do clip "$(printf 'm%02d' $((m * 5)))" "${minutes[$m]}"; done

ls "$out" | wc -l | xargs echo "clips written to $out:"
