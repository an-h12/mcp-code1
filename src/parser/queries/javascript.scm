; Functions
(function_declaration
  name: (identifier) @name) @symbol

(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: [(arrow_function) (function_expression)])) @symbol

; Classes
(class_declaration
  name: (type_identifier) @name) @symbol

(class_declaration
  name: (identifier) @name) @symbol

; Methods inside class body
(method_definition
  name: (property_identifier) @name) @symbol

; TypeScript interface / type alias / enum
(interface_declaration
  name: (type_identifier) @name) @symbol

(type_alias_declaration
  name: (type_identifier) @name) @symbol

(enum_declaration
  name: (identifier) @name) @symbol
