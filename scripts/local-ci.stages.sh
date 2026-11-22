# Stage definitions for the shared verified-release-kit runner.
LOCAL_CI_NAME="pi-android-screenshots"
LOCAL_CI_DESCRIPTION="Mirrors .github/workflows/ci.yml (ubuntu-latest test job)."
LOCAL_CI_STAGES=(tests)
LOCAL_CI_DEFAULT_STAGES=(tests)

prepare() { node_min 22; require npm ""; npm ci --omit=peer --ignore-scripts; }

stage_tests() { npm test; }
