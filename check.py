import re

filename = r'C:\Users\mauri koop junior\.gemini\antigravity\scratch\barbearia_deploy\app.js'
with open(filename, 'r', encoding='utf-8') as f:
    text = f.read()

# remove line comments
text = re.sub(r'//.*', '', text)
# remove block comments
text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
# remove all strings safely
text = re.sub(r"'[^']*'", '', text)
text = re.sub(r'"[^"]*"', '', text)
text = re.sub(r'`[^`]*`', '', text, flags=re.DOTALL)

stack = []
lines = text.split('\n')
for i, line in enumerate(lines):
    for char in line:
        if char == '{': stack.append(('{', i+1))
        elif char == '(': stack.append(('(', i+1))
        elif char == '[': stack.append(('[', i+1))
        elif char == '}': 
            if stack and stack[-1][0] == '{': stack.pop()
            else: print('Unexpected } at line', i+1)
        elif char == ')': 
            if stack and stack[-1][0] == '(': stack.pop()
            else: print('Unexpected ) at line', i+1)
        elif char == ']': 
            if stack and stack[-1][0] == '[': stack.pop()
            else: print('Unexpected ] at line', i+1)

if len(stack) > 0:
    print('Unclosed brackets found:')
    for b in stack:
        print(f'{b[0]} opened at line {b[1]}')
else:
    print('Perfectly balanced')
