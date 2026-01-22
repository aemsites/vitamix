#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
input_file="${repo_root}/tools/importer/articles.txt"
output_dir="${repo_root}/.cache/ca/fr_ca/articles"

mkdir -p "${output_dir}"

total_urls="$(awk 'NF && $1 !~ /^#/' "${input_file}" | wc -l | tr -d ' ')"
current=0

while IFS= read -r url || [[ -n "${url}" ]]; do
  url="${url#"${url%%[![:space:]]*}"}"
  url="${url%"${url##*[![:space:]]}"}"
  [[ -z "${url}" ]] && continue
  [[ "${url}" == \#* ]] && continue

  current=$((current + 1))
  clean_url="${url%/}"
  clean_url="${clean_url%%\#*}"
  clean_url="${clean_url%%\?*}"
  slug="${clean_url##*/}"
  if [[ -z "${slug}" ]]; then
    echo "Skipping empty slug for URL: ${url}" >&2
    continue
  fi
  html_path="${output_dir}/${slug}"
  json_path="${html_path}.json"
  headers_tmp="$(mktemp)"
  body_tmp="$(mktemp)"

  while true; do
    echo "[${current}/${total_urls}] Fetching ${url}"
    if ! curl -sS -L -D "${headers_tmp}" -o "${body_tmp}" "${url}"; then
      echo "Failed to fetch ${url}" >&2
      rm -f "${headers_tmp}" "${body_tmp}"
      break
    fi

    status="$(awk 'BEGIN{s=0} /^HTTP\/[0-9.]+/ {s=$2} END{print s}' "${headers_tmp}")"
    if [[ "${status}" == "202" ]]; then
      echo "Got 202 for ${url}. Waiting 30s before retry."
      rm -f "${body_tmp}"
      sleep 30
      continue
    fi

    if [[ ! -s "${body_tmp}" ]]; then
      echo "Empty response body for ${url}. Retrying in 5s."
      rm -f "${body_tmp}"
      sleep 5
      continue
    fi

    mv "${body_tmp}" "${html_path}"
    break
  done

  python3 - "${headers_tmp}" "${json_path}" <<'PY'
import json
import re
import sys

headers_path, json_path = sys.argv[1:3]

with open(headers_path, "rb") as f:
    raw = f.read()

text = raw.decode("iso-8859-1")
blocks = re.split(r"\r?\n\r?\n", text)
blocks = [b for b in blocks if b.strip()]
last = blocks[-1].splitlines()

status = 0
headers = {}
if last:
    status_line = last[0]
    match = re.search(r"\s(\d{3})\s", status_line)
    if match:
        status = int(match.group(1))
    for line in last[1:]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip().lower()
        value = value.strip()
        if key in headers:
            headers[key] = f"{headers[key]}, {value}"
        else:
            headers[key] = value

with open(json_path, "w", encoding="utf-8") as f:
    json.dump({"headers": headers, "status": status}, f, separators=(",", ":"))
PY

  rm -f "${headers_tmp}"
  echo "Saved ${html_path} and ${json_path}"
done < "${input_file}"

