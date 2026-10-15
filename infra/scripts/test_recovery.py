#!/usr/bin/env python3
"""Negative fixtures для schema/known-good records и недоверенных backup payloads."""

import io
import json
from pathlib import Path
import tarfile
import tempfile
import shutil
import subprocess
import textwrap
import unittest

import data_recovery
import release_recovery


class RecoveryTests(unittest.TestCase):
    def test_actual_workflow_trap_keeps_prior_state_at_every_mutating_stage(self):
        workflow = Path(".github/workflows/deploy-production.yml").read_text()
        failure = workflow[workflow.index("          on_failure() {"):workflow.index("          trap on_failure ERR")]
        stage = workflow[workflow.index("          stage() {"):workflow.index("          stage config")]
        for phase in ("config", "pull", "runtime", "health", "selection"):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                scripts = root / "infra/scripts"
                scripts.mkdir(parents=True)
                for name in ("release_recovery.py", "release_manifest.py"):
                    shutil.copyfile(Path("infra/scripts") / name, scripts / name)
                prior = {"release_digest": "sha256:" + "a" * 64, "source_sha": "b" * 40}
                release_recovery.atomic_write(root / "record.json", {"schema_version": 1, "previous": prior})
                (root / ".env.server").write_text("fixture unchanged\n")
                shell = "set -euo pipefail\nRECOVERY_RECORD=record.json\nSTAGE=preflight\n" + textwrap.dedent(failure) + "\ntrap on_failure ERR\n" + textwrap.dedent(stage) + f"\nstage {phase}\nfalse\n"
                result = subprocess.run(["bash", "-c", shell], cwd=root, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                record = json.loads((root / "record.json").read_text())
                self.assertEqual((record["previous"], record["stage"], record["status"]), (prior, phase, "failed"))
                self.assertIn(f"failed at {phase}", result.stderr)
                self.assertEqual((root / ".env.server").read_text(), "fixture unchanged\n")

    def test_schema_changes_need_exact_compatible_declaration(self):
        old = {"services/aero-chat/db/schema/one.sql": "a" * 64}
        new = dict(old, **{"services/aero-chat/db/schema/two.sql": "b" * 64})
        previous_sha, candidate_sha = "a" * 40, "b" * 40
        for invalid in (None, {}, {"image_rollback_compatible": False}):
            with self.assertRaises(ValueError):
                release_recovery.schema_policy(previous_sha, candidate_sha, old, new, invalid)
        declaration = {
            "schema_version": 1, "previous_sha": previous_sha, "candidate_sha": candidate_sha,
            "previous_inventory_sha256": release_recovery.inventory_digest(old),
            "candidate_inventory_sha256": release_recovery.inventory_digest(new),
            "image_rollback_compatible": True, "review": "fixture reviewed nullable extension", "evidence": "actual old-query integration", "roll_forward": "keep additive schema; replace broken application",
        }
        result = release_recovery.schema_policy(previous_sha, candidate_sha, old, new, declaration)
        self.assertEqual(result["added"], ["services/aero-chat/db/schema/two.sql"])
        for key, value in (("candidate_sha", "c" * 40), ("image_rollback_compatible", False), ("schema_version", True), ("evidence", "")):
            with self.assertRaises(ValueError):
                release_recovery.schema_policy(previous_sha, candidate_sha, old, new, dict(declaration, **{key: value}))
        for changed in ({}, {next(iter(old)): "c" * 64}):
            with self.assertRaises(ValueError):
                release_recovery.schema_policy(previous_sha, candidate_sha, old, changed, declaration)

    def test_actual_schema_must_match_previous(self):
        inventory = {"services/aero-chat/db/schema/one.sql": "a" * 64}
        row = {"service_name": "aero-chat", "migration_name": "one.sql", "checksum": "a" * 64}
        release_recovery.schema_state(inventory, [row])
        for wrong in ([], [dict(row, checksum="b" * 64)], [row, row], [dict(row, checksum=True)], {}):
            with self.assertRaises(ValueError):
                release_recovery.schema_state(inventory, wrong)

    def test_stage_failure_keeps_previous_and_env_pair(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record = root / "record.json"
            env = root / "env"
            old_sha, digest = "a" * 40, "sha256:" + "c" * 64
            env.write_text(f"OTHER_CONFIG=preserved\nAERO_RELEASE_SOURCE_SHA={old_sha}\nAERO_RELEASE_DIGEST={digest}\n")
            previous = {"release_digest": digest, "source_sha": old_sha}
            initial = env.read_bytes()
            for stage in release_recovery.STAGES[:-1]:
                release_recovery.atomic_write(record, {"schema_version": 1, "previous": previous})
                release_recovery.advance(record, stage, "failed")
                value = json.loads(record.read_text())
                self.assertEqual(value["previous"], previous)
                self.assertEqual(value["stage"], stage)
                self.assertEqual(value["status"], "failed")
                self.assertEqual(env.read_bytes(), initial)
            with self.assertRaises(ValueError):
                release_recovery.save_selection(env, "bad", digest)
            self.assertEqual(env.read_bytes(), initial)
            release_recovery.save_selection(env, "b" * 40, digest)
            self.assertEqual(release_recovery.selected(env), ("b" * 40, digest))
            self.assertIn("OTHER_CONFIG=preserved", env.read_text())

    def test_unknown_or_partial_previous_never_means_safe_bootstrap(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "env"
            for value in ("", "AERO_RELEASE_SOURCE_SHA=" + "a" * 40, "AERO_RELEASE_DIGEST=sha256:" + "b" * 64):
                path.write_text(value)
                with self.assertRaises(ValueError):
                    release_recovery.selected(path)

    def test_storage_tar_rejects_traversal_links_and_duplicate(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "storage.tar"
            for name, kind in (("../escape", tarfile.REGTYPE), ("/absolute", tarfile.REGTYPE), ("symlink", tarfile.SYMTYPE), ("device", tarfile.CHRTYPE), ("hardlink", tarfile.LNKTYPE)):
                with tarfile.open(path, "w") as archive:
                    entry = tarfile.TarInfo(name)
                    entry.type = kind
                    entry.linkname = "../escape"
                    archive.addfile(entry)
                with self.assertRaises(ValueError):
                    data_recovery.verify_tar(path)
            with tarfile.open(path, "w") as archive:
                archive.addfile(tarfile.TarInfo("object"))
                archive.addfile(tarfile.TarInfo("./object"))
            with self.assertRaises(ValueError):
                data_recovery.verify_tar(path)

    def test_bundle_rejects_malformed_inventory_and_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            objects = root / "storage.tar"
            with tarfile.open(objects, "w") as archive:
                archive.addfile(tarfile.TarInfo("object"))
            (root / "database.dump").write_bytes(b"fixture dump")
            manifest = {"schema_version": 1, "source_project": "owned-source", "quiesced_at": "fixture", "snapshot_completed_at": "fixture", "database": "fixture", "postgres_major": 17, "minio_image_id": "fixture", "minio_revision": "fixture", "release": {}, "release_digest": "sha256:" + "a" * 64, "schema_migrations": [], "payloads": {name: data_recovery.checksum(root / name) for name in ("storage.tar", "database.dump")}}
            bundle = root / "bundle.tar"
            def write_bundle(value):
                with tarfile.open(bundle, "w") as archive:
                    content = json.dumps(value).encode()
                    metadata = tarfile.TarInfo("manifest.json")
                    metadata.size = len(content)
                    archive.addfile(metadata, io.BytesIO(content))
                    for name in ("storage.tar", "database.dump"):
                        archive.add(root / name, arcname=name)
            write_bundle(manifest)
            with tempfile.TemporaryDirectory() as target:
                self.assertEqual(data_recovery.unpack(bundle, Path(target))["source_project"], "owned-source")
            (root / "database.dump").write_bytes(b"tampered dump")
            for value in (manifest, dict(manifest, schema_version=True), dict(manifest, payloads=[])):
                write_bundle(value)
                with tempfile.TemporaryDirectory() as target:
                    with self.assertRaises(ValueError):
                        data_recovery.unpack(bundle, Path(target))


if __name__ == "__main__":
    unittest.main()
