-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
-- Risu native module settings -> chat-local Chronicle overrides.
-- No prompt injection, display regex, API keys, or network calls.
local fields = {
  interval = "chronicle_interval",
  recent = "chronicle_recent",
  chars = "chronicle_chars",
  tokens = "chronicle_tokens",
  batches = "chronicle_batches",
  risu_chars = "chronicle_risu_chars",
  risu_chunks = "chronicle_risu_chunks"
}

local function readSetting(id, name)
  local value = getGlobalVar(id, "toggle_chronicle_ctl_" .. name)
  if value == nil or value == "null" then return "" end
  return tostring(value):match("^%s*(.-)%s*$")
end

function onStart(id)
  setChatVar(id, "chronicle_budget", "inherit")
  setChatVar(id, "chronicle_timeout", "inherit")
  local enabled = readSetting(id, "enabled")
  setChatVar(id, "chronicle_enabled", enabled == "1" and "1" or enabled == "2" and "0" or "inherit")
  for setting, variable in pairs(fields) do
    local value = readSetting(id, setting)
    setChatVar(id, variable, enabled ~= "1" and "inherit" or value == "" and "inherit" or value)
  end
  local mode = readSetting(id, "mode")
  setChatVar(id, "chronicle_mode", enabled ~= "1" and "inherit" or mode == "1" and "standalone" or mode == "2" and "hybrid" or mode == "3" and "risu" or "inherit")
  local trim = readSetting(id, "trim")
  setChatVar(id, "chronicle_raw_trim", enabled ~= "1" and "inherit" or trim == "1" and "rolling" or trim == "2" and "chunk" or "inherit")
  local scope = readSetting(id, "risu_scope")
  setChatVar(id, "chronicle_risu_scope", enabled ~= "1" and "inherit" or scope == "1" and "all" or scope == "2" and "recent" or scope == "3" and "none" or "inherit")
  local clean = readSetting(id, "clean")
  setChatVar(id, "chronicle_clean", enabled ~= "1" and "inherit" or clean == "1" and "1" or clean == "2" and "0" or "inherit")
end
