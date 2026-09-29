## 1. Minimal Change Discipline
- Make the SMALLEST functional change possible to fulfill the request.
- Do NOT reformat, rename variables, or tidy up files outside the target scope.

## 2. Abstraction Restrictions (YAGNI)
- Follow YAGNI (You Aren't Gonna Need It). Inline everything by default.
- Do NOT introduce interfaces, factory functions, abstract base classes, or generic wrappers for a single use case.
- Do NOT create new helper files or utility modules if the code fits in the existing file.
- Do NOT add configuration parameters, feature flags, or extra flexibility for "future-proofing".

## 3. Defensive Code & Dependencies
- Do NOT add npm packages or external libraries if the solution can be written in a few lines of standard code.
- Do NOT wrap non-throwing operations in `try/except` blocks or write handlers for scenarios that cannot occur.
- Only validate data at external system boundaries (API endpoints, user inputs). Trust internal application state.

## 4. Documentation & Comments
- Do NOT add docstrings, comments, or type annotations to unchanged code.
- Keep comments strictly to non-obvious "why" explanations. Never write comments that explain "what" obvious code is doing.