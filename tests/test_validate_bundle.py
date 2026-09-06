import unittest

from validate_bundle import supported_schema_versions


class SupportedSchemaVersionsTests(unittest.TestCase):
    def test_accepts_const_contract(self) -> None:
        schema = {"properties": {"schema_version": {"const": "1.0.0"}}}

        self.assertEqual(supported_schema_versions(schema), ["1.0.0"])

    def test_accepts_migration_enum(self) -> None:
        schema = {
            "properties": {
                "schema_version": {"enum": ["1.0.0", "1.1.0"]},
            }
        }

        self.assertEqual(supported_schema_versions(schema), ["1.0.0", "1.1.0"])

    def test_rejects_missing_contract(self) -> None:
        with self.assertRaisesRegex(SystemExit, "schema_version must define"):
            supported_schema_versions({"properties": {"schema_version": {}}})


if __name__ == "__main__":
    unittest.main()
