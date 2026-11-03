# Evaluation plan

## Status

The assessment PDF was not supplied. The following questions are a reusable evaluation set, not test results. No accuracy, retrieval, citation, or hallucination rates are claimed.

## Sample questions

### Text

- What is the document's stated purpose?
- Summarize the recommendations in the conclusion.
- Which assumptions does the author explicitly list?

### Tables

- What is the value for the requested row and column?
- Which year has the highest value in the named table?
- Calculate the average of a numeric column and cite the source table.
- Compare the two specified rows without filling in missing values.

### Figures

- Describe the labeled components in the specified figure.
- What trend can be read from the chart, and which labels support it?
- Which parts of the diagram are visible, and which relationships are uncertain?

### Abstention and isolation

- Ask for a fact that is absent and verify the system says it could not find evidence.
- Ask a question about a different uploaded document and verify document scoping.
- Include instruction-like text in a PDF and verify it is treated only as document content.

## Measurements to record

- Retrieval relevance and whether retrieved items cover the expected evidence.
- Answer correctness against a human-verified reference.
- Citation document, page, and excerpt correctness.
- Table fidelity for headers, cells, and computed results.
- Figure description fidelity to visible labels and trends.
- Abstention correctness for unanswerable questions.
- Processing success and failures by content type.

Run this evaluation only on documents with verified ground truth. Report dataset, model/configuration, failures, and limitations alongside any measured results.
