using System;
using System.IO;
using System.Collections.Generic;

class Program
{
    static void Main()
    {
        string text = File.ReadAllText(@"C:\Users\mauri koop junior\.gemini\antigravity\scratch\barbearia_deploy\app.js");
        var stack = new Stack<string>();
        int line = 1;
        bool inString = false;
        char stringChar = '\0';
        bool inTemplate = false;
        bool inLineComment = false;
        bool inBlockComment = false;

        for (int i = 0; i < text.Length; i++)
        {
            char c = text[i];
            char nextC = i + 1 < text.Length ? text[i + 1] : '\0';

            if (c == '\n')
            {
                line++;
                if (inLineComment) inLineComment = false;
            }

            if (inLineComment) continue;

            if (inBlockComment)
            {
                if (c == '*' && nextC == '/')
                {
                    inBlockComment = false;
                    i++;
                }
                continue;
            }

            if (inString)
            {
                if (c == '\\') i++;
                else if (c == stringChar) inString = false;
                continue;
            }

            if (inTemplate)
            {
                if (c == '\\') i++;
                else if (c == '$' && nextC == '{')
                {
                    stack.Push("{:" + line);
                    i++;
                }
                else if (c == '`') inTemplate = false;
                continue;
            }

            if (c == '/' && nextC == '/')
            {
                inLineComment = true;
                i++;
            }
            else if (c == '/' && nextC == '*')
            {
                inBlockComment = true;
                i++;
            }
            else if (c == '\'' || c == '"')
            {
                inString = true;
                stringChar = c;
            }
            else if (c == '`')
            {
                inTemplate = true;
            }
            else if (c == '{' || c == '(' || c == '[')
            {
                stack.Push(c + ":" + line);
            }
            else if (c == '}' || c == ')' || c == ']')
            {
                if (stack.Count > 0)
                {
                    string top = stack.Peek();
                    if ((c == '}' && top.StartsWith("{")) ||
                        (c == ')' && top.StartsWith("(")) ||
                        (c == ']' && top.StartsWith("[")))
                    {
                        stack.Pop();
                    }
                    else
                    {
                        Console.WriteLine("Mismatched " + c + " at line " + line + ". Top of stack: " + top);
                        return;
                    }
                }
                else
                {
                    Console.WriteLine("Unexpected " + c + " at line " + line);
                    return;
                }
            }
        }

        if (stack.Count > 0)
        {
            Console.WriteLine("Unclosed brackets:");
            foreach (var item in stack)
            {
                Console.WriteLine(item);
            }
        }
        else
        {
            Console.WriteLine("Perfectly balanced!");
        }
    }
}
