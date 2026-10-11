import copy
import hashlib
import json
import unittest

from release_manifest import ARTIFACT_TYPE, SERVICES, validate, validate_artifact, verify_blob, verify_runtime


class ReleaseManifestTest(unittest.TestCase):
    def setUp(self):
        self.sha = "a" * 40
        self.namespace = "ghcr.io/mattoyuzuru"
        self.release = {
            "schema_version": 1,
            "source_sha": self.sha,
            "images": {service: f"{self.namespace}/aerochat-{service}@sha256:{'b' * 64}" for service in SERVICES},
        }

    def test_complete_immutable_release(self):
        self.assertEqual(validate(self.release, self.sha, self.namespace), self.release)

    def test_incomplete_extra_or_wrong_sha_release_is_rejected(self):
        for mutation in ("missing", "extra", "sha"):
            release = copy.deepcopy(self.release)
            if mutation == "missing":
                del release["images"]["web"]
            elif mutation == "extra":
                release["images"]["unknown"] = release["images"]["web"]
            else:
                release["source_sha"] = "c" * 40
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                validate(release, self.sha, self.namespace)

    def test_tags_foreign_repositories_and_bad_digest_are_rejected(self):
        for ref in (
            f"{self.namespace}/aerochat-web:edge",
            f"{self.namespace}/aerochat-aero-chat@sha256:{'b' * 64}",
            f"ghcr.io/attacker/aerochat-web@sha256:{'b' * 64}",
            f"{self.namespace}/aerochat-web@sha256:broken",
        ):
            release = copy.deepcopy(self.release)
            release["images"]["web"] = ref
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                validate(release, self.sha, self.namespace)

    def test_artifact_source_type_size_and_single_layer(self):
        manifest = {
            "schemaVersion": 2,
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "artifactType": ARTIFACT_TYPE,
            "annotations": {"org.opencontainers.image.revision": self.sha},
            "layers": [{"mediaType": ARTIFACT_TYPE, "digest": f"sha256:{'b' * 64}", "size": 100}],
        }
        self.assertEqual(validate_artifact(manifest, self.sha), f"sha256:{'b' * 64}")
        for mutation in ("source", "type", "layer", "size", "schema_float", "size_bool", "annotations_list", "digest_int", "media_type_list"):
            invalid = copy.deepcopy(manifest)
            if mutation == "source":
                invalid["annotations"]["org.opencontainers.image.revision"] = "c" * 40
            elif mutation == "type":
                invalid["artifactType"] = "foreign"
            elif mutation == "layer":
                invalid["layers"].append(copy.deepcopy(invalid["layers"][0]))
            elif mutation == "size":
                invalid["layers"][0]["size"] = 65537
            elif mutation == "schema_float":
                invalid["schemaVersion"] = 2.0
            elif mutation == "size_bool":
                invalid["layers"][0]["size"] = True
            elif mutation == "annotations_list":
                invalid["annotations"] = []
            elif mutation == "digest_int":
                invalid["layers"][0]["digest"] = 123
            else:
                invalid["layers"][0]["mediaType"] = []
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                validate_artifact(invalid, self.sha)

    def test_blob_digest_and_size_must_match_before_selection(self):
        data = json.dumps(self.release).encode()
        manifest = {
            "schemaVersion": 2,
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "artifactType": ARTIFACT_TYPE,
            "annotations": {"org.opencontainers.image.revision": self.sha},
            "layers": [{"mediaType": ARTIFACT_TYPE, "digest": f"sha256:{hashlib.sha256(data).hexdigest()}", "size": len(data)}],
        }
        verify_blob(manifest, data, self.sha)
        for changed in (data + b" ", data[:-1] + b" "):
            with self.assertRaises(ValueError):
                verify_blob(manifest, changed, self.sha)

    def test_runtime_rejects_wrong_source_digest_and_stopped_container(self):
        for mutation in (None, "source", "digest", "stopped"):
            def run(command, text):
                if command[1] == "compose":
                    return command[-1] + "\n"
                service = command[-1]
                config = {"Image": self.release["images"][service], "Labels": {"org.opencontainers.image.revision": self.sha}}
                if mutation == "source":
                    config["Labels"]["org.opencontainers.image.revision"] = "c" * 40
                elif mutation == "digest":
                    config["Image"] = f"{self.namespace}/aerochat-{service}:edge"
                return json.dumps([{"Config": config, "State": {"Running": mutation != "stopped"}}])
            with self.subTest(mutation=mutation):
                if mutation is None:
                    verify_runtime(self.release, ["docker", "compose"], run)
                else:
                    with self.assertRaises(ValueError):
                        verify_runtime(self.release, ["docker", "compose"], run)


if __name__ == "__main__":
    unittest.main()
