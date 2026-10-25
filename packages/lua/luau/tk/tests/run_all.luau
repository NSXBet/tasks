--!strict
-- Runs every tk library suite in order, stopping at the first failure.
-- Usage: lune run packages/lua/luau/tk/tests/run_all.luau
local process = require("@lune/process")

for _, suite in { "json_tests", "transport_tests", "client_tests", "events_tests", "integration_tests" } do
	require("./" .. suite)
end
print("tk lua: all suites passed")

-- The suites all stop their servers, but the transport suite's aborted-request
-- probe leaves socket I/O residue that keeps the lune loop alive once client
-- suites' sockets also exist (standalone runs exit fine; the chain hangs).
-- Exit explicitly so CI gets a clean status instead of a 280s timeout kill.
process.exit(0)
