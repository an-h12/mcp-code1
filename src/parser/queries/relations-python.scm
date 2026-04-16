; import module: import os, import os.path
(import_statement (dotted_name) @import.name) @import

; from import: from .models import User
(import_from_statement
  module_name: (dotted_name) @import.module
  name: (dotted_name) @import.name) @import.from

; function calls: foo(), obj.foo()
(call
  function: [(identifier) @call.name
             (attribute attribute: (identifier) @call.name)]) @call

; class inheritance: class A(B, C)
(class_definition
  name: (identifier) @class.name
  (argument_list (identifier) @base.name)) @class.base
