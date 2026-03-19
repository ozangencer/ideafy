#!/bin/bash
# Pre-commit hook: Cloud kodunun solo repo'ya girmesini engelle

CLOUD_PATTERNS=(
  "@supabase/supabase-js"
  "from.*lib/team"
  "from.*@supabase"
  "poolCardId"
  "poolOrigin"
  "pool_list|pool_push|pool_pull|pool_claim"
  "NEXT_PUBLIC_SUPABASE"
)

# Files that legitimately reference cloud patterns (guard script, docs, templates)
EXCLUDED_FILES=(
  "scripts/check-no-cloud-code.sh"
  "scripts/CLAUDE-cloud-template.md"
  "CLAUDE.md"
  "README.md"
)

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)
VIOLATIONS=""

for file in $STAGED_FILES; do
  # Skip excluded files
  skip=false
  for excluded in "${EXCLUDED_FILES[@]}"; do
    if [ "$file" = "$excluded" ]; then
      skip=true
      break
    fi
  done
  if $skip; then continue; fi

  for pattern in "${CLOUD_PATTERNS[@]}"; do
    if git show ":$file" 2>/dev/null | grep -qE "$pattern"; then
      VIOLATIONS="$VIOLATIONS\n  $file: matched '$pattern'"
    fi
  done
done

if [ -n "$VIOLATIONS" ]; then
  echo "CLOUD CODE DETECTED in solo repo!"
  echo -e "Violations:$VIOLATIONS"
  echo ""
  echo "Cloud kodu solo (public) repo'ya giremez."
  echo "Cloud ozelliklerini ideafy-cloud repo'sunda gelistirin."
  exit 1
fi
