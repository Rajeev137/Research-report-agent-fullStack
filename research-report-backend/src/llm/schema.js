const Ajv = require("ajv");
const ajv = new Ajv({ allErrors: true });

const finalSchema = {
  type: "object",
  required: ["company","company_overview","highlights","slides"],
  properties: {
    company: { type: "string" },
    company_overview: { type: "string" },
    highlights: {
      type: "array",
      items: {
        type: "object",
        required: ["id","title","url","one_line_summary","sales_bullet","suggested_question"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          url: { type: "string" },
          one_line_summary: { type: "string" },
          sales_bullet: { type: "string" },
          suggested_question: { type: "string" }
        },
        additionalProperties: false
      }
    },
    slides: {
      type: "array",
      items: {
        type: "object",
        required: ["slide_number","slide_title","bullet_points"],
        properties: {
          slide_number: { type: "number" },
          slide_title: { type: "string" },
          bullet_points: { type: "array", items: { type: "string" } }
        },
        additionalProperties: false
      }
    }
  },
  additionalProperties: false
};
const validateFinal = ajv.compile(finalSchema);

module.exports = { validateFinal, finalSchema };