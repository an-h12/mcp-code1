; import: import "fmt", import alias "pkg/path"
(import_spec path: (interpreted_string_literal) @import.path) @import

; function calls: foo(), pkg.Foo()
(call_expression
  function: [(identifier) @call.name
             (selector_expression field: (field_identifier) @call.name)]) @call

; struct embedding (treated as EXTENDS): type A struct { B }
(field_declaration
  type: (type_identifier) @extends.name
  (#not-match? @extends.name "^[a-z]")) @struct.embed

; interface embedding: type I interface { J }
(method_elem
  type: (type_identifier) @extends.name) @interface.embed
