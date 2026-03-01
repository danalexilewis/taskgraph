#!/usr/bin/env bash
# Run the test suite for task_02_fix_test stub
cd ./stub
bun test
exit_code=$?
if [ $exit_code -ne 0 ]; then
  exit $exit_code
fi
