#!/usr/bin/env bash
# Instala as skills do Adalink Integration Kit no repositório de destino.
# Uso:
#   ./scripts/install-skills.sh [caminho-do-projeto]   # com o kit clonado
#   curl -fsSL https://raw.githubusercontent.com/Adalink-ai/adalink-integration-kit/main/scripts/install-skills.sh | bash
set -euo pipefail

TARGET="${1:-$(pwd)}"
DEST="$TARGET/.claude/skills"
SKILLS=(adaflow-sso adaflow-assistants adaflow-autonomous-agent adaflow-generic-chat adaflow-knowledge-repository)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || true)"
LOCAL_SKILLS_DIR="$SCRIPT_DIR/../skills"

mkdir -p "$DEST"

if [ -d "$LOCAL_SKILLS_DIR/adaflow-sso" ]; then
  # Execução a partir do kit clonado
  for skill in "${SKILLS[@]}"; do
    mkdir -p "$DEST/$skill"
    cp "$LOCAL_SKILLS_DIR/$skill/SKILL.md" "$DEST/$skill/SKILL.md"
    echo "✓ $skill"
  done
else
  # Execução via curl | bash — baixa direto do GitHub
  BASE="https://raw.githubusercontent.com/Adalink-ai/adalink-integration-kit/main/skills"
  for skill in "${SKILLS[@]}"; do
    mkdir -p "$DEST/$skill"
    curl -fsSL "$BASE/$skill/SKILL.md" -o "$DEST/$skill/SKILL.md"
    echo "✓ $skill"
  done
fi

echo ""
echo "Skills instaladas em $DEST"
echo "Guia completo: https://github.com/Adalink-ai/adalink-integration-kit/blob/main/docs/INTEGRATED-APPS-GUIDE.md"
