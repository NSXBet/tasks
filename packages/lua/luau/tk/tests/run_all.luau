--!strict
-- Runs every tk library suite in order, stopping at the first failure.
-- Usage: lune run packages/lua/luau/tk/tests/run_all.luau
for _, suite in { "json_tests", "transport_tests", "client_tests", "events_tests", "integration_tests" } do
	require("./" .. suite)
end
print("tk lua: all suites passed")
