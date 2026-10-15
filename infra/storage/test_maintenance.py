import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("maintenance", Path(__file__).with_name("verify-maintenance.py"))
maintenance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(maintenance)


class MaintenanceProvenanceTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.manifest = {
            "schemaVersion": 1,
            "compilerImage": maintenance.COMPILER,
            "goVersion": "1.27.2",
            "govulncheckVersion": "1.7.0",
            "components": {},
        }
        for name, upstream in maintenance.UPSTREAM.items():
            directory = self.directory / "deps" / name
            directory.mkdir(parents=True)
            hashes = {}
            for filename in ("go.mod", "go.sum"):
                path = directory / filename
                path.write_text("synthetic provenance fixture " + name + filename)
                hashes[filename] = maintenance.digest(path)
            self.manifest["components"][name] = {"upstream": copy.deepcopy(upstream), "effectiveModuleHashes": hashes}
            (directory / "effective.sha256").write_text("".join(hashes[p] + "  " + p + "\n" for p in ("go.mod", "go.sum")))

    def test_mutated_overlay_cannot_reuse_checked_manifest(self):
        maintenance.validate(self.manifest, self.directory)
        (self.directory / "deps/minio/go.mod").write_text("different module graph")
        with self.assertRaises(ValueError):
            maintenance.validate(self.manifest, self.directory)

    def test_missing_second_component_is_not_partial_success(self):
        del self.manifest["components"]["mc"]
        with self.assertRaises(ValueError):
            maintenance.validate(self.manifest, self.directory)

    def test_checksum_recipe_cannot_skip_module_files(self):
        (self.directory / "deps/mc/effective.sha256").write_text("")
        with self.assertRaises(ValueError):
            maintenance.validate(self.manifest, self.directory)

    def test_changed_original_provenance_is_rejected(self):
        self.manifest["components"]["mc"]["upstream"]["commit"] = "0" * 40
        with self.assertRaises(ValueError):
            maintenance.validate(self.manifest, self.directory)

    def test_bool_schema_and_unpinned_compiler_are_rejected(self):
        for key, value in (("schemaVersion", True), ("compilerImage", "golang:latest")):
            changed = copy.deepcopy(self.manifest)
            changed[key] = value
            with self.assertRaises(ValueError):
                maintenance.validate(changed, self.directory)

    def test_wrong_archive_rejected_before_source_verification(self):
        archive = self.directory / "wrong.tar.gz"
        archive.write_bytes(b"synthetic unverified archive")
        with self.assertRaises(ValueError):
            maintenance.verify_original(self.manifest, "minio", self.directory / "missing-source", archive)


if __name__ == "__main__":
    unittest.main()
