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

; class/record/struct inheritance — base_list is flat
(class_declaration
  name: (identifier) @class.name
  (base_list (_) @base.name)) @class.base
