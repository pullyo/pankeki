# Automatic Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans within the files assigned by root. Do not create additional workers.

**Goal:** Remove per-message chat/generate/edit selection while preserving the existing narrow operation and asset boundaries.

**Architecture:** Existing provider reasoning chooses the first image tool; an auto-only atomic latch binds one operation and frozen action settings to the request. Readonly viewing stays independent of the request's send-time target.

**Tech Stack:** Existing Electron/vanilla JS, Codex app-server, Claude CLI and six isolated Pankeki tools; no new dependency.

**Spec and executable task plan:** [Design](../../../output/finalization-20261026/automatic-composer/architecture/design.md), [scoped plan](../../../output/finalization-20261026/automatic-composer/architecture/plan.md).

The architecture folder is the single plan authority. This link was written during read-only design; it does not release production implementation or authorize build/runtime/inference work.
