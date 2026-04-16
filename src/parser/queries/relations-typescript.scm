; ES module imports: import { foo } from './bar'
(import_statement
  source: (string (string_fragment) @import.path)) @import

; require calls: const x = require('./foo')
(call_expression
  function: (identifier) @_req (#eq? @_req "require")
  arguments: (arguments (string (string_fragment) @import.path))) @import.require

; function/method calls: foo(), obj.foo()
(call_expression
  function: [(identifier) @call.name
             (member_expression property: (property_identifier) @call.name)]) @call

; class extends: class A extends B  (TS wraps in extends_clause)
(class_declaration
  name: (type_identifier) @class.name
  (class_heritage (extends_clause value: (identifier) @extends.name))) @class.extends

; interface extends: interface A extends B
(interface_declaration
  name: (type_identifier) @interface.name
  (extends_type_clause type: (type_identifier) @extends.name)) @interface.extends

; implements: class A implements B
(class_declaration
  name: (type_identifier) @class.name
  (class_heritage (implements_clause (type_identifier) @implements.name))) @class.implements
