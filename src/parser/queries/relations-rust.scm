; use declarations: use std::io::Write
(use_declaration argument: (scoped_identifier) @import.name) @import
(use_declaration argument: (identifier) @import.name) @import.simple

; function calls: foo(), self.foo(), Struct::foo()
(call_expression
  function: [(identifier) @call.name
             (field_expression field: (field_identifier) @call.name)
             (scoped_identifier name: (identifier) @call.name)]) @call

; impl for trait (IMPLEMENTS): impl Trait for Struct
(impl_item
  trait: (type_identifier) @implements.name
  type: (type_identifier) @class.name) @impl.trait

; struct newtype (EXTENDS): struct A(B)
(struct_item
  name: (type_identifier) @class.name
  body: (ordered_field_declaration_list
    (type_identifier) @extends.name)) @struct.newtype
