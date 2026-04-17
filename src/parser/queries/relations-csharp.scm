; using directives (all variants)
(using_directive [(qualified_name) (identifier)] @import.name) @import

; member access calls: obj.Method()
(invocation_expression
  function: (member_access_expression
    name: (identifier) @call.name)) @call.member

; simple calls: Method()
(invocation_expression
  function: (identifier) @call.name) @call.simple

; constructor calls: new ClassName()
(object_creation_expression
  type: (identifier) @call.constructor) @call.new

; class/record/struct inheritance — base_list entries can be a plain identifier,
; a generic_name (e.g. BaseRepository<T, U>), or a primary_constructor_base_type
; (C# 10+ record inherit like `: Animal(Name)`). We only want the outer type
; identifier, NOT the full generic_name text or the ctor args.
(class_declaration
  (base_list [
    (identifier)                                                @base.name
    (generic_name                    (identifier) @base.name)
    (primary_constructor_base_type   (identifier) @base.name)
  ])) @class.base

(struct_declaration
  (base_list [
    (identifier)                                                @base.name
    (generic_name                    (identifier) @base.name)
  ])) @struct.base

(record_declaration
  (base_list [
    (identifier)                                                @base.name
    (generic_name                    (identifier) @base.name)
    (primary_constructor_base_type   (identifier) @base.name)
  ])) @record.base

(interface_declaration
  (base_list [
    (identifier)                                                @base.name
    (generic_name                    (identifier) @base.name)
  ])) @interface.base
