# NumberUnitField

A number with its unit or currency joined into one control: *120 bags*, *1,080.00 USD*, *$24,800*.

- **Provide:** the value, the unit options (or a fixed `affix` like `$`), and a `unitLabel` for the select's accessible name.
- Use `inputmode="decimal"` and right-align the number so quantities line up. Keep separators as typed and parse on save.
- Errors say what to enter: "Enter how many books were delivered."
- Don't split a quantity and its unit into separate fields with separate labels.
