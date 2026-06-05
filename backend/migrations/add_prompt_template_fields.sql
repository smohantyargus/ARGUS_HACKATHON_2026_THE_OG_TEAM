-- Add input_variables and output_schema to prompt_templates
ALTER TABLE prompt_templates
    ADD COLUMN IF NOT EXISTS input_variables TEXT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS output_schema   TEXT DEFAULT NULL;
